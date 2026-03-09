import { Router } from "express";
import pool from "../db/pool.js";
import { requireRole } from "../auth/middleware.js";
import { logAudit } from "../audit.js";
import { validate, userRoleSchema, userActiveSchema } from "../validation.js";

const router = Router();

// All admin routes require admin role
router.use(requireRole("admin"));

// Dashboard stats
router.get("/dashboard", async (req, res) => {
  const [
    { rows: [toolStats] },
    { rows: trackCounts },
    { rows: statusCounts },
    { rows: [reviewStats] },
    { rows: [pipelineStats] },
    { rows: [userStats] },
  ] = await Promise.all([
    pool.query("SELECT COUNT(*) as total FROM tools"),
    pool.query("SELECT track, COUNT(*) as count FROM tools WHERE track IS NOT NULL GROUP BY track ORDER BY track"),
    pool.query("SELECT status, COUNT(*) as count FROM tools GROUP BY status ORDER BY status"),
    pool.query("SELECT COUNT(*) as pending FROM tools WHERE status IN ('under_review', 'changes_requested')"),
    pool.query("SELECT COUNT(*) as recent FROM pipeline_runs WHERE queued_at > NOW() - INTERVAL '30 days'"),
    pool.query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_active) as active FROM users"),
  ]);

  const byTrack = {};
  trackCounts.forEach(r => { byTrack[r.track] = parseInt(r.count); });
  const byStatus = {};
  statusCounts.forEach(r => { byStatus[r.status] = parseInt(r.count); });

  res.json({
    totalTools: parseInt(toolStats.total),
    pendingReviews: parseInt(reviewStats.pending),
    recentPipelineRuns: parseInt(pipelineStats.recent),
    totalUsers: parseInt(userStats.total),
    activeUsers: parseInt(userStats.active),
    byTrack,
    byStatus,
  });
});

// List users
router.get("/users", async (req, res) => {
  const { rows: users } = await pool.query(
    `SELECT u.*, (SELECT COUNT(*) FROM tools WHERE owner_id = u.id) as tool_count
     FROM users u ORDER BY u.created_at DESC`
  );
  res.json({ users });
});

// Change user role
router.patch("/users/:id/role", validate(userRoleSchema), async (req, res) => {
  const { role } = req.validated;

  const userId = parseInt(req.params.id);
  const { rows: [user] } = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
  if (!user) return res.status(404).json({ error: "User not found" });

  const oldRole = user.role;
  const { rows: [updated] } = await pool.query(
    "UPDATE users SET role = $1 WHERE id = $2 RETURNING *",
    [role, userId]
  );

  await logAudit({
    actorId: req.user.userId, actorNetid: req.user.netid,
    action: "change_role", entityType: "user", entityId: String(userId),
    details: { from: oldRole, to: role, targetNetid: user.netid },
  });

  res.json({ user: updated });
});

// Toggle user active status
router.patch("/users/:id/active", validate(userActiveSchema), async (req, res) => {
  const { active } = req.validated;

  const userId = parseInt(req.params.id);
  if (userId === req.user.userId) {
    return res.status(400).json({ error: "Cannot deactivate yourself" });
  }

  const { rows: [user] } = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
  if (!user) return res.status(404).json({ error: "User not found" });

  const { rows: [updated] } = await pool.query(
    "UPDATE users SET is_active = $1 WHERE id = $2 RETURNING *",
    [active, userId]
  );

  await logAudit({
    actorId: req.user.userId, actorNetid: req.user.netid,
    action: active ? "activate_user" : "deactivate_user",
    entityType: "user", entityId: String(userId),
    details: { targetNetid: user.netid },
  });

  res.json({ user: updated });
});

// Audit log with filters
router.get("/audit", async (req, res) => {
  const actor = req.query.actor || null;
  const entityType = req.query.entityType?.replace(/[^a-z_]/g, "") || null;
  const action = req.query.action?.replace(/[^a-z_]/g, "") || null;
  const from = req.query.from || null;
  const to = req.query.to || null;
  const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 50), 100);
  const offset = Math.max(0, parseInt(req.query.offset) || 0);

  let where = [];
  let params = [];
  let idx = 1;

  if (actor) { where.push(`actor_netid ILIKE $${idx++}`); params.push(`%${actor}%`); }
  if (entityType) { where.push(`entity_type = $${idx++}`); params.push(entityType); }
  if (action) { where.push(`action = $${idx++}`); params.push(action); }
  if (from) { where.push(`created_at >= $${idx++}`); params.push(from); }
  if (to) { where.push(`created_at <= $${idx++}`); params.push(to); }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [{ rows: entries }, { rows: [{ count }] }] = await Promise.all([
    pool.query(
      `SELECT * FROM audit_log ${whereClause} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(limit), parseInt(offset)]
    ),
    pool.query(`SELECT COUNT(*) FROM audit_log ${whereClause}`, params),
  ]);

  res.json({ entries, total: parseInt(count), limit, offset });
});

// Data retention — admin-triggered cleanup
router.post("/retention", async (req, res) => {
  const dryRun = req.query.dryRun === "true";
  try {
    const { runRetention } = await import("../jobs/retention.js");
    const result = await runRetention({ dryRun });
    await logAudit({
      actorId: req.user.userId, actorNetid: req.user.netid,
      action: "run_retention", entityType: "system", entityId: "retention",
      details: result,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
