import pool from "./db/pool.js";

/**
 * Write an audit log entry.
 * @param {object} entry - Audit fields
 * @param {import("pg").PoolClient} [client] - Optional transaction client
 */
export async function logAudit({ actorId, actorNetid, action, entityType, entityId, details = {} }, client) {
  const db = client || pool;
  await db.query(
    `INSERT INTO audit_log (actor_id, actor_netid, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actorId, actorNetid, action, entityType, entityId, JSON.stringify(details)]
  );
}
