import { Router } from "express";
import pool from "../db/pool.js";
import { requireRole, requireOwnerOrRole } from "../auth/middleware.js";
import { logAudit } from "../audit.js";

const router = Router();

// Review queue — reviewers and admins see all tools needing review
router.get("/queue", requireRole("reviewer", "admin"), async (req, res) => {
  const { rows: tools } = await pool.query(
    `SELECT t.*, u.netid as owner_netid, u.display_name as owner_name,
       (SELECT MAX(completed_at) FROM pipeline_runs WHERE tool_id = t.id) as last_run_at,
       (SELECT status FROM pipeline_runs WHERE tool_id = t.id ORDER BY queued_at DESC LIMIT 1) as latest_run_status
     FROM tools t LEFT JOIN users u ON t.owner_id = u.id
     WHERE t.status IN ('under_review', 'changes_requested')
     ORDER BY t.updated_at ASC`
  );
  res.json({ tools });
});

// Review decision — approve or request changes
router.post("/:toolId/decision", requireRole("reviewer", "admin"), async (req, res) => {
  const { toolId } = req.params;
  const { decision, notes } = req.body;

  if (!decision || !["approved", "changes_requested"].includes(decision)) {
    return res.status(400).json({ error: "decision must be 'approved' or 'changes_requested'" });
  }

  const { rows: [tool] } = await pool.query("SELECT * FROM tools WHERE id = $1", [toolId]);
  if (!tool) return res.status(404).json({ error: "Tool not found" });
  if (tool.status !== "under_review") {
    return res.status(400).json({ error: `Cannot review a tool with status '${tool.status}'` });
  }

  const { rows: [updated] } = await pool.query(
    `UPDATE tools SET status = $1, review_decision = $1, review_decided_at = NOW(),
       review_decided_by = $2, updated_at = NOW()
     WHERE id = $3 RETURNING *`,
    [decision, req.user.userId, toolId]
  );

  // Create review note
  await pool.query(
    `INSERT INTO review_notes (tool_id, author_id, body, note_type, metadata)
     VALUES ($1, $2, $3, 'status_change', $4)`,
    [toolId, req.user.userId, notes || `Status changed to ${decision}`,
     JSON.stringify({ from: "under_review", to: decision })]
  );

  await logAudit({
    actorId: req.user.userId, actorNetid: req.user.netid,
    action: `review_${decision}`, entityType: "tool", entityId: toolId,
    details: { from: "under_review", to: decision, notes },
  });

  res.json({ tool: updated });
});

// Track override
router.post("/:toolId/track-override", requireRole("reviewer", "admin"), async (req, res) => {
  const { toolId } = req.params;
  const { newTrack, reason } = req.body;

  if (!newTrack || newTrack < 1 || newTrack > 4) {
    return res.status(400).json({ error: "newTrack must be 1-4" });
  }
  if (!reason) return res.status(400).json({ error: "reason is required" });

  const { rows: [tool] } = await pool.query("SELECT * FROM tools WHERE id = $1", [toolId]);
  if (!tool) return res.status(404).json({ error: "Tool not found" });

  const oldTrack = tool.track;
  const { rows: [updated] } = await pool.query(
    "UPDATE tools SET track = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
    [newTrack, toolId]
  );

  await pool.query(
    `INSERT INTO review_notes (tool_id, author_id, body, note_type, metadata)
     VALUES ($1, $2, $3, 'track_override', $4)`,
    [toolId, req.user.userId, reason,
     JSON.stringify({ from: oldTrack, to: newTrack })]
  );

  await logAudit({
    actorId: req.user.userId, actorNetid: req.user.netid,
    action: "track_override", entityType: "tool", entityId: toolId,
    details: { from: oldTrack, to: newTrack, reason },
  });

  res.json({ tool: updated });
});

// Get review notes for a tool
router.get("/:toolId/notes", async (req, res) => {
  const { toolId } = req.params;
  if (!req.user) return res.status(401).json({ error: "Authentication required" });

  // Builders can see notes on own tools, reviewers/admins see all
  if (req.user.role === "builder") {
    const { rows: [tool] } = await pool.query("SELECT owner_id FROM tools WHERE id = $1", [toolId]);
    if (!tool) return res.status(404).json({ error: "Tool not found" });
    if (tool.owner_id !== req.user.userId) return res.status(403).json({ error: "Insufficient permissions" });
  }

  const { rows: notes } = await pool.query(
    `SELECT rn.*, u.netid as author_netid, u.display_name as author_name
     FROM review_notes rn JOIN users u ON rn.author_id = u.id
     WHERE rn.tool_id = $1 ORDER BY rn.created_at ASC`,
    [toolId]
  );
  res.json({ notes });
});

// Add comment
router.post("/:toolId/notes", async (req, res) => {
  const { toolId } = req.params;
  const { body } = req.body;
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  if (!body || !body.trim()) return res.status(400).json({ error: "body is required" });

  // Builders can comment on own tools, reviewers/admins on any
  if (req.user.role === "builder") {
    const { rows: [tool] } = await pool.query("SELECT owner_id FROM tools WHERE id = $1", [toolId]);
    if (!tool) return res.status(404).json({ error: "Tool not found" });
    if (tool.owner_id !== req.user.userId) return res.status(403).json({ error: "Insufficient permissions" });
  }

  const { rows: [note] } = await pool.query(
    `INSERT INTO review_notes (tool_id, author_id, body, note_type)
     VALUES ($1, $2, $3, 'comment') RETURNING *`,
    [toolId, req.user.userId, body.trim()]
  );

  await logAudit({
    actorId: req.user.userId, actorNetid: req.user.netid,
    action: "add_comment", entityType: "tool", entityId: toolId,
  });

  res.status(201).json({ note });
});

// Self-certify (Track 2 only, builder)
router.post("/:toolId/self-certify", async (req, res) => {
  const { toolId } = req.params;
  if (!req.user) return res.status(401).json({ error: "Authentication required" });

  const { rows: [tool] } = await pool.query("SELECT * FROM tools WHERE id = $1", [toolId]);
  if (!tool) return res.status(404).json({ error: "Tool not found" });
  if (tool.owner_id !== req.user.userId && req.user.role === "builder") {
    return res.status(403).json({ error: "Only the tool owner can self-certify" });
  }
  if (tool.track !== 2) return res.status(400).json({ error: "Self-certification is only for Track 2 tools" });
  if (tool.status !== "under_review") return res.status(400).json({ error: "Tool must be under review to self-certify" });

  const { rows: [updated] } = await pool.query(
    `UPDATE tools SET status = 'active', review_decision = 'self_certified',
       review_decided_at = NOW(), review_decided_by = $1, updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [req.user.userId, toolId]
  );

  await pool.query(
    `INSERT INTO review_notes (tool_id, author_id, body, note_type, metadata)
     VALUES ($1, $2, 'Builder self-certified findings', 'status_change', $3)`,
    [toolId, req.user.userId, JSON.stringify({ from: "under_review", to: "active", method: "self_certify" })]
  );

  await logAudit({
    actorId: req.user.userId, actorNetid: req.user.netid,
    action: "self_certify", entityType: "tool", entityId: toolId,
  });

  res.json({ tool: updated });
});

// Activate approved tool
router.post("/:toolId/activate", requireRole("reviewer", "admin"), async (req, res) => {
  const { toolId } = req.params;
  const { rows: [tool] } = await pool.query("SELECT * FROM tools WHERE id = $1", [toolId]);
  if (!tool) return res.status(404).json({ error: "Tool not found" });
  if (tool.status !== "approved") return res.status(400).json({ error: "Only approved tools can be activated" });

  const { rows: [updated] } = await pool.query(
    "UPDATE tools SET status = 'active', updated_at = NOW() WHERE id = $1 RETURNING *",
    [toolId]
  );

  await pool.query(
    `INSERT INTO review_notes (tool_id, author_id, body, note_type, metadata)
     VALUES ($1, $2, 'Tool activated', 'status_change', $3)`,
    [toolId, req.user.userId, JSON.stringify({ from: "approved", to: "active" })]
  );

  await logAudit({
    actorId: req.user.userId, actorNetid: req.user.netid,
    action: "activate", entityType: "tool", entityId: toolId,
  });

  res.json({ tool: updated });
});

export default router;
