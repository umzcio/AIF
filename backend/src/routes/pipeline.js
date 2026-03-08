import { Router } from "express";
import multer from "multer";
import { execSync } from "child_process";
import { mkdirSync } from "fs";
import { join } from "path";
import pool from "../db/pool.js";
import { enqueue } from "../pipeline/queue.js";
import { onProgress } from "../pipeline/events.js";

const CODEBASES_DIR = process.env.CODEBASES_DIR || "/data/codebases";
const upload = multer({ dest: "/tmp/aif-uploads", limits: { fileSize: 500 * 1024 * 1024 } });
const router = Router();

// Upload codebase for a tool
router.post("/:toolId/upload", upload.single("codebase"), async (req, res) => {
  const { toolId } = req.params;
  const { rows: [tool] } = await pool.query("SELECT * FROM tools WHERE id = $1", [toolId]);
  if (!tool) return res.status(404).json({ error: "Tool not found" });
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const destDir = join(CODEBASES_DIR, toolId);
  mkdirSync(destDir, { recursive: true });
  const filePath = req.file.path;
  const originalName = req.file.originalname || "";

  try {
    if (originalName.endsWith(".zip")) {
      execSync(`unzip -o -q "${filePath}" -d "${destDir}"`, { timeout: 60000 });
    } else if (originalName.endsWith(".tar.gz") || originalName.endsWith(".tgz")) {
      execSync(`tar xzf "${filePath}" -C "${destDir}"`, { timeout: 60000 });
    } else if (originalName.endsWith(".tar")) {
      execSync(`tar xf "${filePath}" -C "${destDir}"`, { timeout: 60000 });
    } else {
      try { execSync(`unzip -o -q "${filePath}" -d "${destDir}"`, { timeout: 60000 }); }
      catch { execSync(`tar xf "${filePath}" -C "${destDir}"`, { timeout: 60000 }); }
    }

    const entries = execSync(`ls "${destDir}"`, { encoding: "utf-8" }).trim().split("\n");
    const codebasePath = entries.length === 1 ? join(destDir, entries[0]) : destDir;

    await pool.query("UPDATE tools SET codebase_path = $1, updated_at = NOW() WHERE id = $2", [codebasePath, toolId]);
    res.json({ codebasePath });
  } catch (err) {
    res.status(400).json({ error: `Failed to extract codebase: ${err.message}` });
  } finally {
    try { execSync(`rm -f "${filePath}"`); } catch {}
  }
});

router.post("/:toolId/run", async (req, res) => {
  const { toolId } = req.params;
  const { track } = req.body;

  const { rows: [tool] } = await pool.query("SELECT * FROM tools WHERE id = $1", [toolId]);
  if (!tool) return res.status(404).json({ error: "Tool not found" });

  try {
    const run = await enqueue(toolId, track);
    res.status(201).json({ run });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:runId", async (req, res) => {
  const { rows: [run] } = await pool.query(
    "SELECT * FROM pipeline_runs WHERE id = $1", [req.params.runId]
  );
  if (!run) return res.status(404).json({ error: "Run not found" });

  const { rows: agents } = await pool.query(
    "SELECT * FROM agent_results WHERE run_id = $1 ORDER BY agent_index", [req.params.runId]
  );

  res.json({ run, agents });
});

router.get("/:runId/stream", async (req, res) => {
  const { rows: [run] } = await pool.query(
    "SELECT * FROM pipeline_runs WHERE id = $1", [req.params.runId]
  );
  if (!run) return res.status(404).json({ error: "Run not found" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Send current state as catch-up
  const { rows: agents } = await pool.query(
    "SELECT * FROM agent_results WHERE run_id = $1 ORDER BY agent_index", [req.params.runId]
  );
  res.write(`data: ${JSON.stringify({ type: "state", run, agents })}\n\n`);

  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    res.write(`data: ${JSON.stringify({ type: "status", status: run.status })}\n\n`);
    res.end();
    return;
  }

  const unsub = onProgress(req.params.runId, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === "status" && (event.status === "completed" || event.status === "failed")) {
      setTimeout(() => res.end(), 100);
    }
  });

  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 30000);

  req.on("close", () => {
    unsub();
    clearInterval(heartbeat);
  });
});

export default router;
