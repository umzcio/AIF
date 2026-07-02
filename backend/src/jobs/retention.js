import { rmSync, existsSync } from "fs";
import { join } from "path";
import pool from "../db/pool.js";

const CODEBASES_DIR = process.env.CODEBASES_DIR || "/data/codebases";

/**
 * Data retention job — archives/deletes old data based on configurable thresholds.
 *
 * @param {object} options
 * @param {number} options.passResultsDays  — delete pass_results older than N days (default 90)
 * @param {number} options.notificationDays — delete read notifications older than N days (default 30)
 * @param {number} options.auditLogDays     — report-only count of audit_log entries older than N days (default 365)
 * @param {number} options.codebaseDays     — prune extracted codebase dirs for tools retired more than N days ago (default 30)
 * @param {boolean} options.dryRun          — if true, only report what would be affected (default false)
 * @returns {Promise<object>} summary of actions taken
 */
export async function runRetention(options = {}) {
  const {
    passResultsDays = 90,
    notificationDays = 30,
    auditLogDays = 365,
    codebaseDays = 30,
    dryRun = false,
  } = options;

  const summary = {
    passResults: { deleted: 0, dryRun },
    notifications: { deleted: 0, dryRun },
    auditLog: { count: 0 },
    codebaseDirs: { found: 0, removed: 0, dryRun },
  };

  // --- Pass results ---
  console.log(`[retention] Checking pass_results older than ${passResultsDays} days...`);
  const { rows: [prCount] } = await pool.query(
    `SELECT COUNT(*) AS cnt FROM pass_results pr
     JOIN pipeline_runs r ON r.id = pr.run_id
     WHERE r.queued_at < NOW() - make_interval(days => $1)`,
    [passResultsDays]
  );
  const passResultsCount = parseInt(prCount.cnt);
  console.log(`[retention] Found ${passResultsCount} pass_results rows to purge.`);

  if (passResultsCount > 0 && !dryRun) {
    const { rowCount } = await pool.query(
      `DELETE FROM pass_results
       WHERE run_id IN (
         SELECT id FROM pipeline_runs
         WHERE queued_at < NOW() - make_interval(days => $1)
       )`,
      [passResultsDays]
    );
    summary.passResults.deleted = rowCount;
    console.log(`[retention] Deleted ${rowCount} pass_results rows.`);
  } else {
    summary.passResults.deleted = dryRun ? passResultsCount : 0;
    if (dryRun) console.log(`[retention] Dry run — would delete ${passResultsCount} pass_results rows.`);
  }

  // --- Read notifications ---
  console.log(`[retention] Checking read notifications older than ${notificationDays} days...`);
  const { rows: [notifCount] } = await pool.query(
    `SELECT COUNT(*) AS cnt FROM notifications
     WHERE read = true
       AND created_at < NOW() - make_interval(days => $1)`,
    [notificationDays]
  );
  const notificationsCount = parseInt(notifCount.cnt);
  console.log(`[retention] Found ${notificationsCount} read notifications to purge.`);

  if (notificationsCount > 0 && !dryRun) {
    const { rowCount } = await pool.query(
      `DELETE FROM notifications
       WHERE read = true
         AND created_at < NOW() - make_interval(days => $1)`,
      [notificationDays]
    );
    summary.notifications.deleted = rowCount;
    console.log(`[retention] Deleted ${rowCount} read notifications.`);
  } else {
    summary.notifications.deleted = dryRun ? notificationsCount : 0;
    if (dryRun) console.log(`[retention] Dry run — would delete ${notificationsCount} read notifications.`);
  }

  // --- Audit log (report only, never delete) ---
  console.log(`[retention] Counting audit_log entries older than ${auditLogDays} days...`);
  const { rows: [auditCount] } = await pool.query(
    `SELECT COUNT(*) AS cnt FROM audit_log
     WHERE created_at < NOW() - make_interval(days => $1)`,
    [auditLogDays]
  );
  summary.auditLog.count = parseInt(auditCount.cnt);
  console.log(`[retention] ${summary.auditLog.count} audit_log entries older than ${auditLogDays} days (report only).`);

  // --- Retired-tool codebase directories (PRAC-05) ---
  // Uses the existing `updated_at` column (touched by every status change,
  // including the transition to 'retired') as the retirement timestamp
  // rather than adding a dedicated `retired_at` column — this only needs
  // day-granularity for a disk-cleanup sweep, so a schema migration isn't
  // warranted. If finer precision is ever needed, add `retired_at
  // TIMESTAMPTZ` in a new migration and switch this query to it.
  console.log(`[retention] Checking retired tools older than ${codebaseDays} days for codebase directory cleanup...`);
  const { rows: retiredTools } = await pool.query(
    `SELECT id FROM tools WHERE status = 'retired' AND updated_at < NOW() - make_interval(days => $1)`,
    [codebaseDays]
  );
  summary.codebaseDirs.found = retiredTools.length;
  console.log(`[retention] Found ${retiredTools.length} retired tools eligible for codebase cleanup.`);

  if (retiredTools.length > 0 && !dryRun) {
    let removed = 0;
    for (const t of retiredTools) {
      const dir = join(CODEBASES_DIR, t.id);
      if (!existsSync(dir)) continue;
      try {
        rmSync(dir, { recursive: true, force: true });
        removed++;
      } catch (err) {
        console.error(`[retention] Failed to remove codebase dir for tool ${t.id}: ${err.message}`);
      }
    }
    summary.codebaseDirs.removed = removed;
    console.log(`[retention] Removed ${removed} retired-tool codebase directories.`);
  } else if (dryRun) {
    console.log(`[retention] Dry run — would check ${retiredTools.length} retired-tool codebase directories.`);
  }

  console.log("[retention] Complete.", JSON.stringify(summary));
  return summary;
}
