import pool from "./db/pool.js";

export async function logAudit({ actorId, actorNetid, action, entityType, entityId, details = {} }) {
  await pool.query(
    `INSERT INTO audit_log (actor_id, actor_netid, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actorId, actorNetid, action, entityType, entityId, JSON.stringify(details)]
  );
}
