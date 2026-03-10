import { Router } from "express";
import pool, { withTransaction } from "../db/pool.js";
import { requireRole } from "../auth/middleware.js";
import { logAudit } from "../audit.js";
import { validate, toolStatusSchema } from "../validation.js";
import log from "../logger.js";

// Valid status values — used for whitelist validation on query params
const VALID_STATUSES = ["draft","pending","in_progress","under_review","approved","changes_requested","active","suspended","retired"];

const router = Router();

// Valid status transitions: { fromStatus: { role: [toStatuses] } }
const TRANSITIONS = {
  draft:             { builder: ["pending"], admin: ["pending"] },
  pending:           { system: ["in_progress"], admin: ["in_progress"] },
  in_progress:       { system: ["under_review", "active"], admin: ["under_review", "active"] },
  under_review:      { reviewer: ["approved", "changes_requested"], admin: ["approved", "changes_requested", "active"] },
  approved:          { reviewer: ["active"], admin: ["active"] },
  changes_requested: { builder: ["pending"], admin: ["pending"] },
  active:            { reviewer: ["under_review", "suspended"], admin: ["under_review", "suspended", "retired"], builder: ["retired"] },
  suspended:         { reviewer: ["under_review"], admin: ["under_review", "active"] },
};

function canTransition(fromStatus, toStatus, role) {
  const allowed = TRANSITIONS[fromStatus];
  if (!allowed) return false;
  const roleAllowed = allowed[role] || [];
  const systemAllowed = allowed.system || [];
  return roleAllowed.includes(toStatus) || systemAllowed.includes(toStatus);
}

// List tools — scoped by role
router.get("/", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 50), 100);
  const offset = (page - 1) * limit;
  const track = req.query.track ? parseInt(req.query.track) : null;
  const rawStatus = req.query.status?.replace(/[^a-z_]/g, "") || null;
  const status = rawStatus && VALID_STATUSES.includes(rawStatus) ? rawStatus : null;

  let where = [];
  let params = [];
  let idx = 1;

  // Builders see own tools + active/approved tools from others
  if (req.user && req.user.role === "builder") {
    where.push(`(t.owner_id = $${idx++} OR t.status IN ('active', 'approved'))`);
    params.push(req.user.userId);
  } else if (!req.user) {
    // Unauthenticated users only see active tools
    where.push("t.status = 'active'");
  }
  // Reviewers and admins see all — no scoping

  if (track) { where.push(`t.track = $${idx++}`); params.push(track); }
  if (status) { where.push(`t.status = $${idx++}`); params.push(status); }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const [{ rows: tools }, { rows: [{ count }] }] = await Promise.all([
      pool.query(
        `SELECT t.*, u.netid as owner_netid, u.display_name as owner_name, pr.last_run_at
         FROM tools t LEFT JOIN users u ON t.owner_id = u.id
         LEFT JOIN (SELECT tool_id, MAX(completed_at) as last_run_at FROM pipeline_runs GROUP BY tool_id) pr ON t.id = pr.tool_id
         ${whereClause} ORDER BY t.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, parseInt(limit), offset]
      ),
      pool.query(`SELECT COUNT(*) FROM tools t ${whereClause}`, params),
    ]);

    res.json({ tools, total: parseInt(count), page, limit });
  } catch (err) {
    log.error("Registry list query failed", { error: err.message });
    res.status(500).json({ error: "Failed to load registry" });
  }
});

router.get("/:id", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });

  const { rows: [tool] } = await pool.query(
    `SELECT t.*, u.netid as owner_netid, u.display_name as owner_name
     FROM tools t LEFT JOIN users u ON t.owner_id = u.id WHERE t.id = $1`,
    [req.params.id]
  );
  if (!tool) return res.status(404).json({ error: "Tool not found" });

  // Builders can only view their own tools or active/approved tools
  if (req.user.role === "builder") {
    const isOwner = tool.owner_id === req.user.userId;
    const isPublic = tool.status === "active" || tool.status === "approved";
    if (!isOwner && !isPublic) return res.status(403).json({ error: "Access denied" });
  }

  const { rows: runs } = await pool.query(
    `SELECT * FROM pipeline_runs WHERE tool_id = $1 ORDER BY queued_at DESC`,
    [req.params.id]
  );

  res.json({ tool, runs });
});

// Update tool status — enforces state machine + role checks
router.patch("/:id/status", validate(toolStatusSchema), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  const { status } = req.validated;

  const updated = await withTransaction(async (client) => {
    const { rows: [tool] } = await client.query("SELECT * FROM tools WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!tool) { res.status(404).json({ error: "Tool not found" }); return null; }

    const role = req.user.role;
    const isOwner = tool.owner_id === req.user.userId;

    if (!canTransition(tool.status, status, role)) {
      if (!(isOwner && canTransition(tool.status, status, "builder"))) {
        res.status(403).json({
          error: `Cannot transition from '${tool.status}' to '${status}' with role '${role}'`
        });
        return null;
      }
    }

    const { rows: [u] } = await client.query(
      "UPDATE tools SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
      [status, req.params.id]
    );
    await logAudit({
      actorId: req.user.userId, actorNetid: req.user.netid,
      action: "status_change", entityType: "tool", entityId: req.params.id,
      details: { from: tool.status, to: status },
    }, client);
    return u;
  });

  if (!updated) return;
  res.json({ tool: updated });
});

// Delete tool — admin only
router.delete("/:id", requireRole("admin"), async (req, res) => {
  const { rows: [existing] } = await pool.query("SELECT * FROM tools WHERE id = $1", [req.params.id]);
  if (!existing) return res.status(404).json({ error: "Tool not found" });

  await withTransaction(async (client) => {
    // All child tables cascade via ON DELETE CASCADE (migration 008)
    await client.query("DELETE FROM tools WHERE id = $1", [req.params.id]);
    await logAudit({
      actorId: req.user.userId, actorNetid: req.user.netid,
      action: "delete_tool", entityType: "tool", entityId: req.params.id,
      details: { name: existing.name },
    }, client);
  });

  res.json({ ok: true });
});

export default router;
