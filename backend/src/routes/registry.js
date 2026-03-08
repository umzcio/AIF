import { Router } from "express";
import pool from "../db/pool.js";

const router = Router();

router.get("/", async (req, res) => {
  const { track, status, page = 1, limit = 50 } = req.query;
  const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

  let where = [];
  let params = [];
  let idx = 1;

  if (track) { where.push(`track = $${idx++}`); params.push(parseInt(track)); }
  if (status) { where.push(`status = $${idx++}`); params.push(status); }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [{ rows: tools }, { rows: [{ count }] }] = await Promise.all([
    pool.query(
      `SELECT t.*, u.netid as owner_netid, u.display_name as owner_name,
         (SELECT MAX(completed_at) FROM pipeline_runs WHERE tool_id = t.id) as last_run_at
       FROM tools t LEFT JOIN users u ON t.owner_id = u.id
       ${whereClause} ORDER BY t.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(limit), offset]
    ),
    pool.query(`SELECT COUNT(*) FROM tools ${whereClause}`, params),
  ]);

  res.json({ tools, total: parseInt(count), page: parseInt(page), limit: parseInt(limit) });
});

router.get("/:id", async (req, res) => {
  const { rows: [tool] } = await pool.query(
    `SELECT t.*, u.netid as owner_netid, u.display_name as owner_name
     FROM tools t LEFT JOIN users u ON t.owner_id = u.id WHERE t.id = $1`,
    [req.params.id]
  );
  if (!tool) return res.status(404).json({ error: "Tool not found" });

  const { rows: runs } = await pool.query(
    `SELECT * FROM pipeline_runs WHERE tool_id = $1 ORDER BY queued_at DESC`,
    [req.params.id]
  );

  res.json({ tool, runs });
});

// Update tool status
router.patch("/:id/status", async (req, res) => {
  const { status } = req.body;
  const allowed = ["pending", "in_progress", "active", "under_review", "suspended", "retired"];
  if (!status || !allowed.includes(status)) return res.status(400).json({ error: `Invalid status. Must be one of: ${allowed.join(", ")}` });

  const { rows: [tool] } = await pool.query(
    "UPDATE tools SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
    [status, req.params.id]
  );
  if (!tool) return res.status(404).json({ error: "Tool not found" });
  res.json({ tool });
});

// Delete any tool (cascades to pipeline_runs via FK)
router.delete("/:id", async (req, res) => {
  const { rows: [existing] } = await pool.query("SELECT * FROM tools WHERE id = $1", [req.params.id]);
  if (!existing) return res.status(404).json({ error: "Tool not found" });

  // Delete associated pipeline runs and agent results first
  await pool.query("DELETE FROM agent_results WHERE run_id IN (SELECT id FROM pipeline_runs WHERE tool_id = $1)", [req.params.id]);
  await pool.query("DELETE FROM pipeline_runs WHERE tool_id = $1", [req.params.id]);
  await pool.query("DELETE FROM tools WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
