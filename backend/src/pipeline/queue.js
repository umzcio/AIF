import pool from "../db/pool.js";
import { runPipeline } from "../orchestrator/index.js";
import { emitProgress, removeAllForRun } from "./events.js";
import { resolve } from "path";
import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";

const OUTPUT_BASE = process.env.OUTPUT_DIR || "/data/output";
const CODEBASES_DIR = process.env.CODEBASES_DIR || "/data/codebases";

let processing = false;

export async function recoverOnStartup() {
  await pool.query(
    `UPDATE pipeline_runs SET status = 'failed', error_message = 'Server restarted during execution', completed_at = NOW() WHERE status = 'running'`
  );
}

export async function enqueue(toolId, track) {
  const { rows: [tool] } = await pool.query("SELECT * FROM tools WHERE id = $1", [toolId]);
  if (!tool) throw new Error("Tool not found");

  const runTrack = track || tool.track;
  const { rows: [run] } = await pool.query(
    `INSERT INTO pipeline_runs (tool_id, track, total_agents) VALUES ($1, $2, 4) RETURNING *`,
    [toolId, runTrack]
  );

  // Create agent_results rows
  const agents = ["code-analysis", "accessibility", "hecvat", "documentation"];
  for (let i = 0; i < agents.length; i++) {
    const passesTotal = i < 2 ? 5 : 1;
    await pool.query(
      `INSERT INTO agent_results (run_id, agent_name, agent_index, passes_total) VALUES ($1, $2, $3, $4)`,
      [run.id, agents[i], i, passesTotal]
    );
  }

  processNext();
  return run;
}

async function processNext() {
  if (processing) return;

  const { rows: [next] } = await pool.query(
    `SELECT pr.*, t.name as tool_name, t.codebase_url, t.codebase_path FROM pipeline_runs pr JOIN tools t ON pr.tool_id = t.id WHERE pr.status = 'queued' ORDER BY pr.queued_at ASC LIMIT 1`
  );
  if (!next) return;

  processing = true;
  const runId = next.id;

  try {
    await pool.query(
      `UPDATE pipeline_runs SET status = 'running', started_at = NOW() WHERE id = $1`,
      [runId]
    );
    await pool.query(
      `UPDATE tools SET status = 'in_progress', updated_at = NOW() WHERE id = $1`,
      [next.tool_id]
    );
    emitProgress(runId, { type: "status", status: "running" });

    // Resolve codebase path
    let codebasePath = next.codebase_path;
    if (!codebasePath && next.codebase_url) {
      const destDir = resolve(CODEBASES_DIR, next.tool_id);
      mkdirSync(destDir, { recursive: true });
      execSync(`git clone --depth 1 ${next.codebase_url} ${destDir}`, { timeout: 120000 });
      codebasePath = destDir;
    }

    if (!codebasePath || !existsSync(codebasePath)) {
      throw new Error(`Codebase not found: ${codebasePath || "(no path)"}`);
    }

    mkdirSync(OUTPUT_BASE, { recursive: true });

    const onProgressCb = (event) => {
      emitProgress(runId, event);

      // Update DB for agent-level events
      if (event.type === "agent_start") {
        pool.query(
          `UPDATE pipeline_runs SET current_agent = $1, current_agent_index = $2 WHERE id = $3`,
          [event.agent, event.index, runId]
        );
        pool.query(
          `UPDATE agent_results SET status = 'running', started_at = NOW() WHERE run_id = $1 AND agent_name = $2`,
          [runId, event.agent]
        );
      } else if (event.type === "agent_complete") {
        pool.query(
          `UPDATE agent_results SET status = 'completed', passes_completed = $1, completed_at = NOW() WHERE run_id = $2 AND agent_name = $3`,
          [event.passes, runId, event.agent]
        );
      } else if (event.type === "pass_complete") {
        pool.query(
          `UPDATE agent_results SET passes_completed = passes_completed + 1 WHERE run_id = $1 AND agent_name = $2`,
          [runId, event.agent]
        );
      }
    };

    const result = await runPipeline({
      codebasePath,
      track: next.track,
      toolName: next.tool_name,
      outputBase: OUTPUT_BASE,
      onProgress: onProgressCb,
    });

    await pool.query(
      `UPDATE pipeline_runs SET status = 'completed', output_dir = $1, summary = $2, completed_at = NOW() WHERE id = $3`,
      [result.outputDir, JSON.stringify(result.agents), runId]
    );

    // Track-based auto-status on pipeline completion:
    // Track 1: auto-activate (skip review)
    // Track 2-4: set to under_review
    const newStatus = next.track === 1 ? "active" : "under_review";
    await pool.query(
      `UPDATE tools SET status = $1, updated_at = NOW() WHERE id = $2`,
      [newStatus, next.tool_id]
    );
    emitProgress(runId, { type: "status", status: "completed" });
  } catch (err) {
    console.error(`Pipeline run ${runId} failed:`, err.message);
    await pool.query(
      `UPDATE pipeline_runs SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2`,
      [err.message, runId]
    );
    // Mark any still-pending agent_results as failed
    await pool.query(
      `UPDATE agent_results SET status = 'failed', error_message = $1, completed_at = NOW() WHERE run_id = $2 AND status IN ('pending', 'running')`,
      [err.message, runId]
    );
    emitProgress(runId, { type: "status", status: "failed", error: err.message });
  } finally {
    processing = false;
    removeAllForRun(runId);
    processNext();
  }
}
