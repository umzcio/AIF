import pool from "./db/pool.js";

/**
 * Write an audit log entry.
 * Source IP is automatically included in details if actorId corresponds to
 * an authenticated request (req.user.ip is set by auth middleware).
 * Callers can also pass `ip` explicitly.
 * @param {object} entry - Audit fields
 * @param {import("pg").PoolClient} [client] - Optional transaction client
 */
export async function logAudit({ actorId, actorNetid, action, entityType, entityId, details = {}, ip }, client) {
  const db = client || pool;
  const enrichedDetails = ip ? { ...details, ip } : details;
  await db.query(
    `INSERT INTO audit_log (actor_id, actor_netid, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actorId, actorNetid, action, entityType, entityId, JSON.stringify(enrichedDetails)]
  );
}

/**
 * Convenience: build logAudit params from an Express request.
 * Automatically includes source IP in details.
 */
export function auditFromReq(req, { action, entityType, entityId, details = {} }) {
  return logAudit({
    actorId: req.user?.userId,
    actorNetid: req.user?.netid,
    action,
    entityType,
    entityId,
    details,
    ip: req.user?.ip || req.ip,
  });
}
