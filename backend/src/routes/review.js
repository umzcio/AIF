import { Router } from "express";
import pool, { withTransaction } from "../db/pool.js";
import { requireRole, requireOwnerOrRole } from "../auth/middleware.js";
import { logAudit } from "../audit.js";
import { notify, notifyRole } from "../notifications.js";
import { validate, reviewDecisionSchema, trackOverrideSchema, reviewNoteSchema, selfCertifySchema } from "../validation.js";
import { canOverrideTrack } from "../review-rules.js";

export { canOverrideTrack };

const router = Router();

// Review queue — reviewers and admins see all tools needing review
router.get("/queue", requireRole("reviewer", "admin"), async (req, res) => {
  const { rows: tools } = await pool.query(
    `SELECT t.*, u.netid as owner_netid, u.display_name as owner_name,
       pr.last_run_at, lr.status as latest_run_status
     FROM tools t LEFT JOIN users u ON t.owner_id = u.id
     LEFT JOIN (SELECT tool_id, MAX(completed_at) as last_run_at FROM pipeline_runs GROUP BY tool_id) pr ON t.id = pr.tool_id
     LEFT JOIN LATERAL (SELECT status FROM pipeline_runs WHERE tool_id = t.id ORDER BY queued_at DESC LIMIT 1) lr ON true
     WHERE t.status IN ('under_review', 'changes_requested')
     ORDER BY t.updated_at ASC`
  );
  res.json({ tools });
});

// Review decision — approve or request changes
router.post("/:toolId/decision", requireRole("reviewer", "admin"), validate(reviewDecisionSchema), async (req, res) => {
  const { toolId } = req.params;
  const { decision, notes } = req.validated;

  const updated = await withTransaction(async (client) => {
    const { rows: [tool] } = await client.query("SELECT * FROM tools WHERE id = $1 FOR UPDATE", [toolId]);
    if (!tool) { res.status(404).json({ error: "Tool not found" }); return null; }
    if (tool.status !== "under_review") {
      res.status(400).json({ error: `Cannot review a tool with status '${tool.status}'` });
      return null;
    }

    const { rows: [u] } = await client.query(
      `UPDATE tools SET status = $1, review_decision = $1, review_decided_at = NOW(),
         review_decided_by = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [decision, req.user.userId, toolId]
    );
    await client.query(
      `INSERT INTO review_notes (tool_id, author_id, body, note_type, metadata)
       VALUES ($1, $2, $3, 'status_change', $4)`,
      [toolId, req.user.userId, notes || `Status changed to ${decision}`,
       JSON.stringify({ from: "under_review", to: decision })]
    );
    await logAudit({
      actorId: req.user.userId, actorNetid: req.user.netid,
      action: `review_${decision}`, entityType: "tool", entityId: toolId,
      details: { from: "under_review", to: decision, notes },
    }, client);
    return u;
  });

  if (!updated) return; // Response already sent inside transaction

  // Notify tool owner of decision
  const notifType = decision === "approved" ? "review_approved" : "review_changes_requested";
  const notifTitle = decision === "approved"
    ? `"${updated.name}" has been approved`
    : `Changes requested for "${updated.name}"`;
  notify({
    userId: updated.owner_id, toolId, type: notifType,
    title: notifTitle, body: notes || null,
    link: `#/tool/${toolId}`,
  }).catch(() => {});

  res.json({ tool: updated });
});

// Track override
router.post("/:toolId/track-override", requireRole("reviewer", "admin"), validate(trackOverrideSchema), async (req, res) => {
  const { toolId } = req.params;
  const { newTrack, reason } = req.validated;

  const result = await withTransaction(async (client) => {
    const { rows: [tool] } = await client.query("SELECT * FROM tools WHERE id = $1 FOR UPDATE", [toolId]);
    if (!tool) { res.status(404).json({ error: "Tool not found" }); return null; }

    const escalations = Array.isArray(tool.escalation_conditions) ? tool.escalation_conditions
      : JSON.parse(tool.escalation_conditions || "[]");
    const check = canOverrideTrack({ oldTrack: tool.track, newTrack, escalations, role: req.user.role });
    if (!check.allowed) { res.status(403).json({ error: check.reason }); return null; }

    const oldTrack = tool.track;
    const { rows: [u] } = await client.query(
      "UPDATE tools SET track = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
      [newTrack, toolId]
    );
    await client.query(
      `INSERT INTO review_notes (tool_id, author_id, body, note_type, metadata)
       VALUES ($1, $2, $3, 'track_override', $4)`,
      [toolId, req.user.userId, reason,
       JSON.stringify({ from: oldTrack, to: newTrack })]
    );
    await logAudit({
      actorId: req.user.userId, actorNetid: req.user.netid,
      action: "track_override", entityType: "tool", entityId: toolId,
      details: { from: oldTrack, to: newTrack, reason },
    }, client);
    return { updated: u, oldTrack };
  });

  if (!result) return; // Response already sent inside transaction

  // Notify tool owner of track override
  notify({
    userId: result.updated.owner_id, toolId, type: "track_override",
    title: `Track changed for "${result.updated.name}": Track ${result.oldTrack} → Track ${newTrack}`,
    body: reason, link: `#/tool/${toolId}`,
  }).catch(() => {});

  res.json({ tool: result.updated });
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
router.post("/:toolId/notes", validate(reviewNoteSchema), async (req, res) => {
  const { toolId } = req.params;
  const { body } = req.validated;
  if (!req.user) return res.status(401).json({ error: "Authentication required" });

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

  // Notify tool owner of new comment (unless they wrote it)
  const { rows: [commentTool] } = await pool.query("SELECT owner_id, name FROM tools WHERE id = $1", [toolId]);
  if (commentTool && commentTool.owner_id !== req.user.userId) {
    notify({
      userId: commentTool.owner_id, toolId, type: "comment",
      title: `New comment on "${commentTool.name}"`,
      body: body.trim().slice(0, 200), link: `#/tool/${toolId}`,
    }).catch(() => {});
  }

  res.status(201).json({ note });
});

// Self-certify (Track 2 only, owner only)
router.post("/:toolId/self-certify", validate(selfCertifySchema), async (req, res) => {
  const { toolId } = req.params;
  const { attestation } = req.validated;
  if (!req.user) return res.status(401).json({ error: "Authentication required" });

  const updated = await withTransaction(async (client) => {
    const { rows: [tool] } = await client.query("SELECT * FROM tools WHERE id = $1 FOR UPDATE", [toolId]);
    if (!tool) { res.status(404).json({ error: "Tool not found" }); return null; }
    if (tool.owner_id !== req.user.userId) {
      res.status(403).json({ error: "Only the tool owner can self-certify" }); return null;
    }
    if (tool.track !== 2) { res.status(400).json({ error: "Self-certification is only for Track 2 tools" }); return null; }
    if (tool.status !== "under_review") { res.status(400).json({ error: "Tool must be under review to self-certify" }); return null; }

    const { rows: [u] } = await client.query(
      `UPDATE tools SET status = 'active', review_decision = 'self_certified',
         review_decided_at = NOW(), review_decided_by = $1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [req.user.userId, toolId]
    );
    await client.query(
      `INSERT INTO review_notes (tool_id, author_id, body, note_type, metadata)
       VALUES ($1, $2, $3, 'status_change', $4)`,
      [toolId, req.user.userId, `Self-certification: ${attestation}`,
       JSON.stringify({ from: "under_review", to: "active", method: "self_certify",
         attestation, confirmFindingsReviewed: true, confirmEscalationsUnderstood: true })]
    );
    await logAudit({
      actorId: req.user.userId, actorNetid: req.user.netid,
      action: "self_certify", entityType: "tool", entityId: toolId,
      details: { attestation: attestation.slice(0, 500) },
    }, client);
    return u;
  });

  if (!updated) return;

  // Notify reviewers/admins that a tool was self-certified
  notifyRole({
    role: "reviewer", toolId, type: "tool_activated",
    title: `"${updated.name}" self-certified and activated`,
    body: `Track 2 tool self-certified by ${req.user.netid}`,
    link: `#/tool/${toolId}`,
  }).catch(() => {});
  notifyRole({
    role: "admin", toolId, type: "tool_activated",
    title: `"${updated.name}" self-certified and activated`,
    body: `Track 2 tool self-certified by ${req.user.netid}`,
    link: `#/tool/${toolId}`,
  }).catch(() => {});

  res.json({ tool: updated });
});

// Activate approved tool
router.post("/:toolId/activate", requireRole("reviewer", "admin"), async (req, res) => {
  const { toolId } = req.params;

  const updated = await withTransaction(async (client) => {
    const { rows: [tool] } = await client.query("SELECT * FROM tools WHERE id = $1 FOR UPDATE", [toolId]);
    if (!tool) { res.status(404).json({ error: "Tool not found" }); return null; }
    if (tool.status !== "approved") { res.status(400).json({ error: "Only approved tools can be activated" }); return null; }
    if (tool.sandbox) { res.status(400).json({ error: "Cannot activate a sandboxed tool. Remove from sandbox first." }); return null; }

    const { rows: [u] } = await client.query(
      "UPDATE tools SET status = 'active', updated_at = NOW() WHERE id = $1 RETURNING *",
      [toolId]
    );
    await client.query(
      `INSERT INTO review_notes (tool_id, author_id, body, note_type, metadata)
       VALUES ($1, $2, 'Tool activated', 'status_change', $3)`,
      [toolId, req.user.userId, JSON.stringify({ from: "approved", to: "active" })]
    );
    await logAudit({
      actorId: req.user.userId, actorNetid: req.user.netid,
      action: "activate", entityType: "tool", entityId: toolId,
    }, client);
    return u;
  });

  if (!updated) return;

  // Notify tool owner that their tool is now active
  notify({
    userId: updated.owner_id, toolId, type: "tool_activated",
    title: `"${updated.name}" is now active`,
    body: "Your tool has been approved and activated in the registry.",
    link: `#/tool/${toolId}`,
  }).catch(() => {});

  res.json({ tool: updated });
});

export default router;
