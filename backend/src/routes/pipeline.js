import { Router } from "express";
import multer from "multer";
import { join } from "path";
import pool from "../db/pool.js";
import { enqueue, cancelRun, retryRun } from "../pipeline/queue.js";
import { onProgress, getToolStates } from "../pipeline/events.js";
import { requireOwnerOrRole, requireRole } from "../auth/middleware.js";
import { logAudit } from "../audit.js";
import { validate, pipelineRunSchema } from "../validation.js";
import { extractArchive } from "../utils/extract.js";
import { wrap } from "../middleware/async-handler.js";

const CODEBASES_DIR = process.env.CODEBASES_DIR || "/data/codebases";
const upload = multer({ dest: "/tmp/aif-uploads", limits: { fileSize: 500 * 1024 * 1024 } });
const router = Router();

/**
 * Verify the requesting user owns the tool associated with a pipeline run,
 * or has reviewer/admin role. Returns the run row or sends 403/404.
 */
async function requireRunAccess(req, res) {
  const { rows: [run] } = await pool.query(
    "SELECT pr.*, t.owner_id FROM pipeline_runs pr JOIN tools t ON pr.tool_id = t.id WHERE pr.id = $1",
    [req.params.runId]
  );
  if (!run) { res.status(404).json({ error: "Run not found" }); return null; }
  if (!req.user) { res.status(401).json({ error: "Authentication required" }); return null; }
  const isOwner = run.owner_id === req.user.userId;
  const isPrivileged = ["reviewer", "admin"].includes(req.user.role);
  if (!isOwner && !isPrivileged) { res.status(403).json({ error: "Insufficient permissions" }); return null; }
  return run;
}

// Upload codebase for a tool (owner or admin)
router.post("/:toolId/upload", requireOwnerOrRole("admin"), upload.single("codebase"), wrap(async (req, res) => {
  const tool = req.tool;
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const toolId = req.params.toolId;

  const destDir = join(CODEBASES_DIR, toolId);

  try {
    const codebasePath = extractArchive(req.file, destDir);
    await pool.query("UPDATE tools SET codebase_path = $1, updated_at = NOW() WHERE id = $2", [codebasePath, toolId]);
    res.json({ codebasePath });
  } catch (err) {
    res.status(400).json({ error: `Failed to extract codebase: ${err.message}` });
  }
}));

router.post("/:toolId/run", requireOwnerOrRole("admin"), validate(pipelineRunSchema), wrap(async (req, res) => {
  const { toolId } = req.params;
  const { mode } = req.validated;

  try {
    const run = await enqueue(toolId, null, null, mode);
    res.status(201).json({ run });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

// Cancel a running pipeline
router.post("/:runId/cancel", wrap(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });

  const { rows: [run] } = await pool.query(
    "SELECT pr.*, t.owner_id FROM pipeline_runs pr JOIN tools t ON pr.tool_id = t.id WHERE pr.id = $1",
    [req.params.runId]
  );
  if (!run) return res.status(404).json({ error: "Run not found" });

  // Only owner, reviewer, or admin can cancel
  if (run.owner_id !== req.user.userId && !["reviewer", "admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  if (!["queued", "running"].includes(run.status)) {
    return res.status(400).json({ error: `Cannot cancel a run with status '${run.status}'` });
  }

  try {
    const result = await cancelRun(req.params.runId);

    await logAudit({
      actorId: req.user.userId, actorNetid: req.user.netid,
      action: "pipeline_cancel", entityType: "pipeline_run", entityId: req.params.runId,
      details: { tool_id: run.tool_id, processesKilled: result.processesKilled },
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

// Retry a failed/cancelled pipeline run
router.post("/:runId/retry", wrap(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });

  const { rows: [run] } = await pool.query(
    "SELECT pr.*, t.owner_id FROM pipeline_runs pr JOIN tools t ON pr.tool_id = t.id WHERE pr.id = $1",
    [req.params.runId]
  );
  if (!run) return res.status(404).json({ error: "Run not found" });

  // Only owner, reviewer, or admin can retry
  if (run.owner_id !== req.user.userId && !["reviewer", "admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  try {
    const newRun = await retryRun(req.params.runId);

    await logAudit({
      actorId: req.user.userId, actorNetid: req.user.netid,
      action: "pipeline_retry", entityType: "pipeline_run", entityId: newRun.id,
      details: { parent_run_id: req.params.runId, tool_id: run.tool_id, retry_count: newRun.retry_count },
    });

    res.status(201).json({ run: newRun });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

router.get("/:runId", wrap(async (req, res) => {
  const run = await requireRunAccess(req, res);
  if (!run) return;

  const { rows: agents } = await pool.query(
    "SELECT * FROM agent_results WHERE run_id = $1 ORDER BY agent_index", [req.params.runId]
  );

  // Include queue position if queued
  let queuePosition = null;
  if (run.status === "queued") {
    const { rows: [pos] } = await pool.query(
      "SELECT COUNT(*) FROM pipeline_runs WHERE status = 'queued' AND queued_at < $1",
      [run.queued_at]
    );
    queuePosition = parseInt(pos.count) + 1;
  }

  res.json({ run, agents, queuePosition });
}));

router.get("/:runId/stream", wrap(async (req, res) => {
  const run = await requireRunAccess(req, res);
  if (!run) return;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Subscribe FIRST to avoid race: if pipeline completes between fetch and
  // subscribe, we'd miss the terminal event. Buffer events until catch-up sent.
  const buffered = [];
  let flushing = false;
  const unsub = onProgress(req.params.runId, (event) => {
    if (!flushing) {
      buffered.push(event);
    } else {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === "status" && ["completed", "failed", "cancelled"].includes(event.status)) {
        setTimeout(() => res.end(), 100);
      }
    }
  });

  // Now fetch current state as catch-up
  const { rows: agents } = await pool.query(
    "SELECT * FROM agent_results WHERE run_id = $1 ORDER BY agent_index", [req.params.runId]
  );
  // Re-read run status in case it changed since the initial query
  const { rows: [freshRun] } = await pool.query(
    "SELECT * FROM pipeline_runs WHERE id = $1", [req.params.runId]
  );
  const currentRun = freshRun || run;

  // Include queue position if queued
  let queuePosition = null;
  if (currentRun.status === "queued") {
    const { rows: [pos] } = await pool.query(
      "SELECT COUNT(*) FROM pipeline_runs WHERE status = 'queued' AND queued_at < $1",
      [currentRun.queued_at]
    );
    queuePosition = parseInt(pos.count) + 1;
  }

  const toolStates = getToolStates(req.params.runId);
  res.write(`data: ${JSON.stringify({ type: "state", run: currentRun, agents, queuePosition, toolStates })}\n\n`);

  // Flush buffered events, then switch to live mode
  flushing = true;
  for (const event of buffered) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === "status" && ["completed", "failed", "cancelled"].includes(event.status)) {
      unsub();
      setTimeout(() => res.end(), 100);
      return;
    }
  }

  // If run is already terminal, end immediately
  if (["completed", "failed", "cancelled"].includes(currentRun.status)) {
    unsub();
    res.write(`data: ${JSON.stringify({ type: "status", status: currentRun.status })}\n\n`);
    res.end();
    return;
  }

  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 30000);

  req.on("close", () => {
    unsub();
    clearInterval(heartbeat);
  });
}));

export default router;
