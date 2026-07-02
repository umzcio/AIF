import pool, { withTransaction } from "../db/pool.js";
import { runDirectApiPipeline } from "../orchestrator/direct-api.js";
import log from "../logger.js";
import { emitProgress, removeAllForRun } from "./events.js";
import { notify, notifyRole } from "../notifications.js";
import { evaluateActivationGate } from "./activation-gate.js";
import { killRunProcesses } from "../agents/shared/cli.js";
import { join, resolve } from "path";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";

/**
 * Validate a URL for safe use in subprocess arguments.
 * Must be https://, no shell metacharacters.
 * If GIT_ALLOWED_HOSTS is set, hostname must be in the allowlist.
 */
const GIT_ALLOWED_HOSTS = process.env.GIT_ALLOWED_HOSTS
  ? process.env.GIT_ALLOWED_HOSTS.split(",").map(h => h.trim().toLowerCase())
  : null;

function validateUrl(url) {
  if (typeof url !== "string") throw new Error("Invalid URL: not a string");
  if (!url.startsWith("https://")) throw new Error("Invalid URL: must start with https://");
  if (/[;|&`$()\n\r]/.test(url)) throw new Error("Invalid URL: contains shell metacharacters");
  if (GIT_ALLOWED_HOSTS) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (!GIT_ALLOWED_HOSTS.includes(hostname)) {
        throw new Error(`Invalid URL: hostname "${hostname}" not in allowed hosts (${GIT_ALLOWED_HOSTS.join(", ")})`);
      }
    } catch (err) {
      if (err.message.includes("not in allowed hosts")) throw err;
      throw new Error("Invalid URL: could not parse hostname");
    }
  }
  return url;
}

/**
 * Estimated cost per model pass (USD).
 * Based on approximate token usage per codebase analysis (~100K input, ~10K output).
 * Updated periodically as pricing changes.
 */
const MODEL_COST_USD = {
  "codex":     0.30,  // GPT-5.4 via Codex CLI (pass 1)
  "minimax":   0.10,  // MiniMax M2.5 via OpenRouter (pass 2)
  "mimo":      0.06,  // MiMo-V2-Flash via OpenRouter (pass 3)
  "kimi":      0.12,  // Kimi K2 via OpenRouter (pass 4)
  "glm":       0.08,  // GLM-5 via OpenRouter (pass 5 + Agent 4 HECVAT)
  "gemini":    0.15,  // Gemini 3.1 Pro Preview (Agent 4 guides)
  "claude":    0.45,  // Claude Opus 4.6 (synthesis + Agent 4 compliance)
};

/**
 * USD per 1M tokens (input, output) for direct-API models.
 * Approximations from provider pricing pages; update alongside MODEL_COST_USD.
 * Passes without recorded tokens (CLI: codex, claude, gemini) use the flat
 * MODEL_COST_USD estimate instead.
 */
const MODEL_TOKEN_RATES = {
  "minimax": { input: 0.30, output: 1.20 },
  "mimo":    { input: 0.10, output: 0.30 },
  "kimi":    { input: 0.60, output: 2.50 },
  "glm":     { input: 0.40, output: 1.60 },
};

const OUTPUT_BASE = process.env.OUTPUT_DIR || "/data/output";
const CODEBASES_DIR = process.env.CODEBASES_DIR || "/data/codebases";
const MAX_RETRIES = 2; // Dead letter after this many total failures

let processing = false;

/** Map of runId → AbortController for cancellation. */
const runControllers = new Map();

export async function recoverOnStartup() {
  const { rowCount } = await pool.query(
    `UPDATE pipeline_runs SET status = 'failed', error_message = 'Server restarted during execution', completed_at = NOW() WHERE status = 'running'`
  );
  if (rowCount > 0) {
    log.info("Recovered stale running pipelines on startup", { count: rowCount });
  }
  // Drain any queued runs left over from before the restart
  const { rows } = await pool.query("SELECT COUNT(*) FROM pipeline_runs WHERE status = 'queued'");
  const queued = parseInt(rows[0].count);
  if (queued > 0) {
    log.info("Found queued pipeline runs on startup, triggering queue processor", { queued });
    processNext();
  }
}

export async function enqueue(toolId, track, parentRunId = null, mode = "direct-api") {
  const { rows: [tool] } = await pool.query("SELECT * FROM tools WHERE id = $1", [toolId]);
  if (!tool) throw new Error("Tool not found");

  const runTrack = track || tool.track;

  // Idempotency guard: reject if this tool already has an active (queued/running) run.
  // Race-proof backstop is the partial unique index added in migration 019 — this
  // check just gives a friendly error in the common (non-racing) case.
  const { rows: activeRuns } = await pool.query(
    "SELECT id FROM pipeline_runs WHERE tool_id = $1 AND status IN ('queued','running') LIMIT 1",
    [toolId]
  );
  if (activeRuns.length) {
    throw new Error("A pipeline run is already active for this tool");
  }

  // Check retry count for dead letter queue
  if (parentRunId) {
    const { rows: [parent] } = await pool.query("SELECT retry_count FROM pipeline_runs WHERE id = $1", [parentRunId]);
    if (parent && parent.retry_count >= MAX_RETRIES) {
      throw new Error(`Max retries (${MAX_RETRIES}) exceeded. Tool moved to dead letter queue.`);
    }
  }

  const retryCount = parentRunId ? (await pool.query("SELECT retry_count FROM pipeline_runs WHERE id = $1", [parentRunId]).then(r => (r.rows[0]?.retry_count || 0) + 1)) : 0;

  // Run row + its 4 agent_results children are created atomically — a crash or
  // dropped connection mid-way must never leave a run with a partial agent set.
  const run = await withTransaction(async (client) => {
    const { rows: [run] } = await client.query(
      `INSERT INTO pipeline_runs (tool_id, track, total_agents, retry_count, parent_run_id, pipeline_mode) VALUES ($1, $2, 4, $3, $4, $5) RETURNING *`,
      [toolId, runTrack, retryCount, parentRunId || null, mode]
    );

    // Create agent_results rows
    const agents = ["code-analysis", "accessibility", "qa-analysis", "documentation"];
    for (let i = 0; i < agents.length; i++) {
      const passesTotal = i < 3 ? 5 : 1;
      await client.query(
        `INSERT INTO agent_results (run_id, agent_name, agent_index, passes_total) VALUES ($1, $2, $3, $4)`,
        [run.id, agents[i], i, passesTotal]
      );
    }
    return run;
  });

  processNext();
  return run;
}

/**
 * Cancel a running pipeline.
 * Kills all child processes and marks the run as cancelled.
 */
export async function cancelRun(runId) {
  // Abort the controller (signals all agents/passes)
  const controller = runControllers.get(runId);
  if (controller) {
    controller.abort();
  }

  // Kill any lingering child processes
  const killed = killRunProcesses(runId);

  // Update DB atomically
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE pipeline_runs SET status = 'cancelled', cancel_requested = true, error_message = 'Cancelled by user', completed_at = NOW() WHERE id = $1 AND status IN ('queued', 'running')`,
      [runId]
    );
    await client.query(
      `UPDATE agent_results SET status = 'failed', error_message = 'Cancelled', completed_at = NOW() WHERE run_id = $1 AND status IN ('pending', 'running')`,
      [runId]
    );
    const { rows: [run] } = await client.query("SELECT tool_id FROM pipeline_runs WHERE id = $1", [runId]);
    if (run) {
      await client.query("UPDATE tools SET status = 'pending', updated_at = NOW() WHERE id = $1 AND status = 'in_progress'", [run.tool_id]);
    }
  });

  emitProgress(runId, { type: "status", status: "cancelled" });
  removeAllForRun(runId);

  log.info("Run cancelled", { runId, processesKilled: killed });
  return { cancelled: true, processesKilled: killed };
}

/**
 * Retry a failed run. Creates a new run linked to the parent.
 */
export async function retryRun(runId) {
  const { rows: [failedRun] } = await pool.query(
    "SELECT * FROM pipeline_runs WHERE id = $1 AND status IN ('failed', 'cancelled')",
    [runId]
  );
  if (!failedRun) throw new Error("Run not found or not in a retryable state");

  if (failedRun.retry_count >= MAX_RETRIES) {
    throw new Error(`Max retries (${MAX_RETRIES}) exceeded for this pipeline. Consider investigating the failure before retrying.`);
  }

  return enqueue(failedRun.tool_id, failedRun.track, runId, failedRun.pipeline_mode);
}

async function processNext() {
  if (processing) return;
  processing = true;

  const { rows: [next] } = await pool.query(
    `SELECT pr.*, t.name as tool_name, t.codebase_url, t.codebase_path FROM pipeline_runs pr JOIN tools t ON pr.tool_id = t.id WHERE pr.status = 'queued' ORDER BY pr.queued_at ASC LIMIT 1`
  );
  if (!next) { processing = false; return; }

  const runId = next.id;

  // Create AbortController for this run
  const controller = new AbortController();
  runControllers.set(runId, controller);

  try {
    // Guard against a concurrent cancel landing between the SELECT above and this
    // UPDATE — only claim the run if it is still 'queued'. If a cancel already
    // flipped the status, rowCount is 0 and we treat this run as already-cancelled.
    const { rowCount } = await pool.query(
      `UPDATE pipeline_runs SET status = 'running', started_at = NOW() WHERE id = $1 AND status = 'queued'`,
      [runId]
    );
    if (rowCount === 0) {
      log.info("Run no longer queued at claim time (concurrent cancel) — skipping", { runId });
      return;
    }
    await pool.query(
      `UPDATE tools SET status = 'in_progress', updated_at = NOW() WHERE id = $1`,
      [next.tool_id]
    );
    emitProgress(runId, { type: "status", status: "running" });

    // Check if already cancelled while queued
    if (next.cancel_requested) {
      throw new Error("Pipeline cancelled before start");
    }

    // Resolve codebase path
    let codebasePath = next.codebase_path;
    if (!codebasePath && next.codebase_url) {
      const destDir = resolve(CODEBASES_DIR, next.tool_id);
      mkdirSync(destDir, { recursive: true });
      validateUrl(next.codebase_url);
      execFileSync("git", ["clone", "--depth", "1", next.codebase_url, destDir], { timeout: 120000 });
      codebasePath = destDir;
    }

    if (!codebasePath || !existsSync(codebasePath)) {
      throw new Error(`Codebase not found: ${codebasePath || "(no path)"}`);
    }

    // Defense-in-depth: codebase_path must be under CODEBASES_DIR.
    // Prevents path traversal even if a bug allows arbitrary paths into the DB.
    const resolvedCodebase = resolve(codebasePath);
    const resolvedBase = resolve(CODEBASES_DIR);
    if (!resolvedCodebase.startsWith(resolvedBase + "/") && resolvedCodebase !== resolvedBase) {
      throw new Error(`Codebase path outside allowed directory: ${resolvedCodebase}`);
    }

    mkdirSync(OUTPUT_BASE, { recursive: true });

    // Load previous run's findings for differential review
    let previousFindings = null;
    try {
      const { rows: [prevRun] } = await pool.query(
        `SELECT output_dir FROM pipeline_runs WHERE tool_id = $1 AND status = 'completed' AND id != $2 ORDER BY completed_at DESC LIMIT 1`,
        [next.tool_id, runId]
      );
      if (prevRun?.output_dir) {
        const prevCodePath = join(prevRun.output_dir, "agent1_code_analysis", "synthesis.json");
        const prevA11yPath = join(prevRun.output_dir, "agent2_accessibility", "synthesis.json");
        const codePrev = existsSync(prevCodePath) ? JSON.parse(readFileSync(prevCodePath, "utf-8")) : null;
        const a11yPrev = existsSync(prevA11yPath) ? JSON.parse(readFileSync(prevA11yPath, "utf-8")) : null;
        const prevQaPath = join(prevRun.output_dir, "agent3_qa", "synthesis.json");
        const qaPrev = existsSync(prevQaPath) ? JSON.parse(readFileSync(prevQaPath, "utf-8")) : null;
        if (codePrev || a11yPrev || qaPrev) {
          previousFindings = { codeAnalysis: codePrev?.findings || [], accessibility: a11yPrev?.findings || [], qaAnalysis: qaPrev?.findings || [] };
          log.info("Loaded previous findings for differential review", { runId, prevRunDir: prevRun.output_dir, codeCount: previousFindings.codeAnalysis.length, a11yCount: previousFindings.accessibility.length, qaCount: previousFindings.qaAnalysis.length });
        }
      }
    } catch (err) {
      log.warn("Failed to load previous findings (non-fatal)", { runId, error: err.message });
    }

    const onProgressCb = (event) => {
      emitProgress(runId, event);

      // Update DB for agent-level events (log errors but don't crash pipeline)
      if (event.type === "agent_start") {
        pool.query(
          `UPDATE pipeline_runs SET current_agent = $1, current_agent_index = $2 WHERE id = $3`,
          [event.agent, event.index, runId]
        ).catch(err => log.error("agent_start DB update failed", { runId, error: err.message }));
        pool.query(
          `UPDATE agent_results SET status = 'running', started_at = NOW() WHERE run_id = $1 AND agent_name = $2`,
          [runId, event.agent]
        ).catch(err => log.error("agent_results start update failed", { runId, error: err.message }));
      } else if (event.type === "agent_complete") {
        pool.query(
          `UPDATE agent_results SET status = 'completed', passes_completed = $1, completed_at = NOW() WHERE run_id = $2 AND agent_name = $3`,
          [event.passes, runId, event.agent]
        ).catch(err => log.error("agent_complete DB update failed", { runId, error: err.message }));
      } else if (event.type === "pass_start") {
        // Insert pass_results row on start
        pool.query(
          `INSERT INTO pass_results (run_id, agent_name, pass_key, model_name, tool, status, attempt)
           VALUES ($1, $2, $3, $4, $5, 'running', 1)
           ON CONFLICT (run_id, agent_name, pass_key, attempt) DO UPDATE SET status = 'running'`,
          [runId, event.agent, event.pass, event.model, event.pass]
        ).catch(err => log.error("pass_start DB insert failed", { runId, error: err.message }));
        // Also increment agent_results (existing behavior removed — pass_complete handles it)
      } else if (event.type === "pass_complete") {
        pool.query(
          `UPDATE agent_results SET passes_completed = passes_completed + 1 WHERE run_id = $1 AND agent_name = $2`,
          [runId, event.agent]
        ).catch(err => log.error("pass_complete DB update failed", { runId, error: err.message }));
        // Update pass_results with timing and success info
        pool.query(
          `UPDATE pass_results SET status = 'completed', elapsed_seconds = $1, completed_at = NOW(),
             json_parsed = $2, output_bytes = $3, prompt_tokens = $4, completion_tokens = $5
           WHERE run_id = $6 AND agent_name = $7 AND pass_key = $8 AND status = 'running'`,
          [event.elapsed || 0, event.jsonParsed !== false, event.outputBytes || 0,
           event.promptTokens ?? null, event.completionTokens ?? null,
           runId, event.agent, event.pass]
        ).catch(err => log.error("pass_complete DB update failed", { runId, error: err.message }));
      } else if (event.type === "pass_failed") {
        // Record pass failure
        const errorCat = event.errorCategory || (event.error?.includes("timed out") ? "timeout" : event.error?.includes("parse") ? "parse_error" : "api_error");
        pool.query(
          `UPDATE pass_results SET status = 'failed', elapsed_seconds = $1, completed_at = NOW(),
             error_message = $2, error_category = $3
           WHERE run_id = $4 AND agent_name = $5 AND pass_key = $6 AND status = 'running'`,
          [event.elapsed || 0, (event.error || "").slice(0, 500), errorCat, runId, event.agent, event.pass]
        ).catch(err => log.error("pass_failed DB update failed", { runId, error: err.message }));
      } else if (event.type === "pass_retry") {
        // Mark previous attempt as failed, insert new attempt
        const errorCat = event.error?.includes("timed out") ? "timeout" : event.error?.includes("parse") ? "parse_error" : "api_error";
        pool.query(
          `UPDATE pass_results SET status = 'failed', completed_at = NOW(), error_message = $1, error_category = $2
           WHERE run_id = $3 AND agent_name = $4 AND pass_key = $5 AND status = 'running'`,
          [(event.error || "").slice(0, 500), errorCat, runId, event.agent, event.pass]
        ).catch(err => log.error("pass_retry update failed", { runId, error: err.message }));
        pool.query(
          `INSERT INTO pass_results (run_id, agent_name, pass_key, model_name, tool, status, attempt)
           VALUES ($1, $2, $3, $4, $5, 'running', $6)
           ON CONFLICT (run_id, agent_name, pass_key, attempt) DO UPDATE SET status = 'running'`,
          [runId, event.agent, event.pass, event.model, event.pass, event.attempt + 1]
        ).catch(err => log.error("pass_retry insert failed", { runId, error: err.message }));
        log.warn("Pass retry", { runId, agent: event.agent, pass: event.pass, attempt: event.attempt, error: event.error });
      }
    };

    const result = await runDirectApiPipeline({
      codebasePath,
      track: next.track,
      toolName: next.tool_name,
      outputBase: OUTPUT_BASE,
      onProgress: onProgressCb,
      runId,
      signal: controller.signal,
      previousFindings,
    });

    // Track-based auto-status on pipeline completion.
    // The track is read fresh from the tool (never from the run row) so a
    // mid-run track override is respected and run creation cannot influence it.
    const { rows: [freshTool] } = await pool.query(
      // intake_answers feeds the FW-02 activation gate below (intake-vs-code contradiction check)
      "SELECT track, owner_id, name, intake_answers FROM tools WHERE id = $1", [next.tool_id]
    );
    const effectiveTrack = freshTool?.track ?? next.track;
    const intakeAnswers = typeof freshTool?.intake_answers === "string"
      ? JSON.parse(freshTool.intake_answers) : (freshTool?.intake_answers || null);
    const anyPartial = ["codeAnalysis", "accessibility", "qaAnalysis"].some(k => result.agents[k]?.partial);
    const gate = evaluateActivationGate({
      track: effectiveTrack,
      answers: intakeAnswers,
      codeSynthesis: result.agents.codeAnalysis?.synthesis || null,
      partial: anyPartial,
      truncated: !!result.bundle?.truncated,
    });
    const newStatus = gate.activate ? "active" : "under_review";

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE pipeline_runs SET status = 'completed', output_dir = $1, summary = $2, activation_gate = $3, completed_at = NOW() WHERE id = $4`,
        [result.outputDir, JSON.stringify(result.agents), JSON.stringify(gate), runId]
      );
      await client.query(
        `UPDATE tools SET status = $1, updated_at = NOW() WHERE id = $2`,
        [newStatus, next.tool_id]
      );
    });

    // Compute and store pipeline metrics (non-critical, outside transaction)
    computePipelineMetrics(runId).catch(err => log.error("Metrics computation failed", { runId, error: err.message }));
    emitProgress(runId, { type: "status", status: "completed" });

    // Notify tool owner of pipeline completion
    const completedTool = freshTool;
    if (completedTool) {
      const pipelineTitle = effectiveTrack === 1 && gate.activate
        ? `"${completedTool.name}" pipeline complete — auto-activated`
        : effectiveTrack === 1
          ? `"${completedTool.name}" pipeline complete — auto-activation blocked, review required`
          : `"${completedTool.name}" pipeline complete — awaiting review`;
      notify({
        userId: completedTool.owner_id, toolId: next.tool_id, type: "pipeline_complete",
        title: pipelineTitle,
        body: `All 4 agents finished. Track ${effectiveTrack} tool.`,
        link: `#/tool/${next.tool_id}/report/${runId}`,
      }).catch(() => {});

      // Notify reviewers if tool needs review (Track 2-4), excluding the owner (already notified above)
      if (newStatus === "under_review") {
        const reviewTitle = gate.blocked
          ? `"${completedTool.name}" auto-activation blocked: ${gate.reasons.join("; ")}`
          : `"${completedTool.name}" needs review (Track ${effectiveTrack})`;
        const exclude = [completedTool.owner_id];
        notifyRole({
          role: "reviewer", toolId: next.tool_id, type: "review_needed",
          title: reviewTitle,
          body: `Pipeline complete. Tool requires reviewer decision.`,
          link: `#/tool/${next.tool_id}`,
          excludeUserIds: exclude,
        }).catch(() => {});
        notifyRole({
          role: "admin", toolId: next.tool_id, type: "review_needed",
          title: reviewTitle,
          body: `Pipeline complete. Tool requires reviewer decision.`,
          link: `#/tool/${next.tool_id}`,
          excludeUserIds: exclude,
        }).catch(() => {});
      }
    }
  } catch (err) {
    const isCancelled = err.message.includes("cancelled") || controller.signal.aborted;
    const status = isCancelled ? "cancelled" : "failed";

    // cancelRun() already aborts + kills for the user-cancel path. For every other
    // failure (agent throw, bundling error, DB error, etc.) nothing has torn down
    // in-flight child processes yet — do it here so a failed run can't orphan them.
    if (!isCancelled) {
      controller.abort();
      const killed = killRunProcesses(runId);
      if (killed > 0) log.warn("Killed orphaned child processes after run failure", { runId, killed });
    }

    log.error("Pipeline run ended", { runId, status, error: err.message });
    await pool.query(
      `UPDATE pipeline_runs SET status = $1, error_message = $2, completed_at = NOW() WHERE id = $3`,
      [status, err.message, runId]
    );
    // Mark any still-pending agent_results as failed
    await pool.query(
      `UPDATE agent_results SET status = 'failed', error_message = $1, completed_at = NOW() WHERE run_id = $2 AND status IN ('pending', 'running')`,
      [err.message, runId]
    );

    // Revert tool status on cancel
    if (isCancelled) {
      const { rows: [run] } = await pool.query("SELECT tool_id FROM pipeline_runs WHERE id = $1", [runId]);
      if (run) {
        await pool.query("UPDATE tools SET status = 'pending', updated_at = NOW() WHERE id = $1 AND status = 'in_progress'", [run.tool_id]);
      }
    }

    emitProgress(runId, { type: "status", status, error: err.message });
  } finally {
    runControllers.delete(runId);
    processing = false;
    removeAllForRun(runId);
    processNext();
  }
}

/**
 * Compute and store aggregate pipeline metrics after a run completes.
 */
async function computePipelineMetrics(runId) {
  const { rows: [run] } = await pool.query(
    "SELECT queued_at, started_at, completed_at FROM pipeline_runs WHERE id = $1", [runId]
  );
  if (!run) return;

  const totalElapsed = run.completed_at && run.started_at
    ? (new Date(run.completed_at) - new Date(run.started_at)) / 1000 : null;
  const queueWait = run.started_at && run.queued_at
    ? (new Date(run.started_at) - new Date(run.queued_at)) / 1000 : null;

  // Aggregate pass results
  const { rows: passes } = await pool.query(
    `SELECT agent_name, pass_key, model_name, tool, status, json_parsed, elapsed_seconds, prompt_tokens, completion_tokens
     FROM pass_results WHERE run_id = $1
     ORDER BY created_at`,
    [runId]
  );

  // Only count the latest attempt per pass_key
  const latestByKey = {};
  for (const p of passes) {
    latestByKey[`${p.agent_name || ""}:${p.pass_key || p.model_name}`] = p;
  }
  const latestPasses = Object.values(latestByKey);

  const succeeded = latestPasses.filter(p => p.status === "completed").length;
  const failed = latestPasses.filter(p => p.status === "failed").length;
  const jsonFailures = latestPasses.filter(p => p.status === "completed" && !p.json_parsed).length;

  // Estimate cost from tools used — token-based when usage was captured,
  // else fall back to the flat per-pass estimate.
  let estimatedCost = 0;
  for (const p of latestPasses) {
    // Synthesis and stack-check passes are covered by the flat Claude synthesis
    // estimate added below — counting them here too double-counts synthesis cost.
    if (p.pass_key === "synthesis" || p.pass_key === "stack-check") continue;
    // Match tool name to cost lookup
    const toolKey = Object.keys(MODEL_COST_USD).find(k => p.tool?.includes(k) || p.model_name?.toLowerCase().includes(k));
    const rates = toolKey && MODEL_TOKEN_RATES[toolKey];
    if (rates && (p.prompt_tokens || p.completion_tokens)) {
      estimatedCost += ((p.prompt_tokens || 0) * rates.input + (p.completion_tokens || 0) * rates.output) / 1_000_000;
    } else if (toolKey) {
      estimatedCost += MODEL_COST_USD[toolKey];
    }
  }
  // Add synthesis costs (3 Claude synthesis for agents 1-3, plus HECVAT call in agent 4)
  estimatedCost += (MODEL_COST_USD.claude || 0) * 4;

  await pool.query(
    `INSERT INTO pipeline_metrics (run_id, total_elapsed_seconds, queue_wait_seconds, estimated_cost_usd,
       models_succeeded, models_failed, passes_total, passes_succeeded, json_parse_failures)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (run_id) DO UPDATE SET
       total_elapsed_seconds = EXCLUDED.total_elapsed_seconds,
       queue_wait_seconds = EXCLUDED.queue_wait_seconds,
       estimated_cost_usd = EXCLUDED.estimated_cost_usd,
       models_succeeded = EXCLUDED.models_succeeded,
       models_failed = EXCLUDED.models_failed,
       passes_total = EXCLUDED.passes_total,
       passes_succeeded = EXCLUDED.passes_succeeded,
       json_parse_failures = EXCLUDED.json_parse_failures`,
    [runId, totalElapsed, queueWait, estimatedCost, succeeded, failed,
     latestPasses.length, succeeded, jsonFailures]
  );
}
