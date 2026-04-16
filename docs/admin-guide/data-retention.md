# Data Retention

AIF retains pipeline pass-level data and read notifications for a configurable window, and treats the audit log as permanent. The retention job is triggered manually by an admin or invoked on a schedule from the host. This document covers configuration, manual execution, and what each data class retains.

## Retention Classes

| Data class | Default retention | Action | Reversible? |
|------------|-------------------|--------|-------------|
| `pass_results` | 90 days | Delete rows older than threshold | No |
| `notifications` (read) | 30 days | Delete rows where `read=true` older than threshold | No |
| `audit_log` | 365 days | **Report only** — count entries, never delete | N/A |
| `pipeline_runs` | No limit | Never deleted | N/A |
| `pipeline_metrics` | No limit | Never deleted | N/A |
| `tools` | No limit | Deleted only via explicit admin action | No |

Pipeline analytics use both `pass_results` (detailed) and `pipeline_metrics` (aggregated). After pass-level rows are purged, per-model detail for old runs is lost; aggregate metrics remain.

Unread notifications are **not** deleted regardless of age. Users must read or acknowledge them before they become eligible.

## Rationale

| Choice | Why |
|--------|-----|
| Pass-level 90 days | Analytics dashboard windows up to 365d operate on aggregate `pipeline_metrics`, not pass detail. Long-tail pass data is low value. |
| Notifications 30 days | Read notifications are transient; users have already seen them. |
| Audit log permanent | Compliance and investigation require an unbroken trail. Manual deletion is possible but requires an institutional records decision. |

## The Retention Job

Source: `backend/src/jobs/retention.js`. Exported function:

```javascript
runRetention({
  passResultsDays = 90,
  notificationDays = 30,
  auditLogDays = 365,
  dryRun = false
})
```

The job runs three phases in order:

1. Count `pass_results` rows whose parent `pipeline_run.queued_at < NOW() - N days`. Delete unless `dryRun`.
2. Count read `notifications` older than N days. Delete unless `dryRun`.
3. Count `audit_log` rows older than N days. **Report only.**

Returns a summary:

```json
{
  "passResults":   {"deleted": 142, "dryRun": false},
  "notifications": {"deleted": 31,  "dryRun": false},
  "auditLog":      {"count": 1203}
}
```

## Manual Trigger (Admin UI)

Retention is not yet exposed as a button in the UI. Trigger via the API.

## Manual Trigger (API)

```bash
# Dry run — reports what would be deleted
curl -X POST "https://example.edu/aif/api/admin/retention?dryRun=true" \
  -H "x-csrf-token: $CSRF" \
  --cookie "aif_token=$JWT; aif_csrf=$CSRF"

# Actual deletion
curl -X POST "https://example.edu/aif/api/admin/retention" \
  -H "x-csrf-token: $CSRF" \
  --cookie "aif_token=$JWT; aif_csrf=$CSRF"
```

Response:

```json
{
  "passResults": {"deleted": 142, "dryRun": false},
  "notifications": {"deleted": 31, "dryRun": false},
  "auditLog": {"count": 1203}
}
```

Every manual trigger writes an audit entry with `action = "run_retention"` and the full summary in `details`.

## Scheduling

The job is not scheduled automatically. Options:

### Host cron

```cron
# /etc/cron.d/aif-retention
0 3 * * 0 root docker exec aif-app node -e 'import("./src/jobs/retention.js").then(m => m.runRetention().then(s => console.log(JSON.stringify(s))))'
```

This runs weekly at 03:00 Sunday. Adjust frequency based on data volume.

### systemd timer

A systemd timer calling `docker exec aif-app node ...` works equivalently and provides richer logging.

### Application scheduler

No in-process scheduler is built in. Adding `node-cron` to the backend would enable scheduled execution without external dependencies, but is not currently wired up.

## Configuring Thresholds

Thresholds are parameters to `runRetention()`. The API endpoint currently ignores query parameters for thresholds — it always uses defaults. To use non-default thresholds from cron, call the function directly inside the container:

```bash
docker exec aif-app node -e '
  import("./src/jobs/retention.js").then(m => m.runRetention({
    passResultsDays: 180,
    notificationDays: 14,
    auditLogDays: 730,
    dryRun: false
  }).then(s => console.log(JSON.stringify(s, null, 2))))
'
```

To make thresholds persistently configurable, set them in a wrapper script or patch `src/routes/admin.js` to accept them as request body fields.

## Impact on Analytics

After a pass_results purge:

- **Pipeline Analytics / Per-Model tab** loses historical pass detail for runs older than the threshold.
- **Summary cards** (total runs, cost, success rate) remain accurate — they use `pipeline_metrics`.
- **Trends chart** — run counts and costs remain accurate; per-model duration trends degrade beyond the threshold.

Set `passResultsDays` higher than the longest analytics period you plan to query (default analytics periods: 30, 90, 180, 365). If you routinely query 180-day model detail, set `passResultsDays >= 180`.

## Audit Log Cleanup

The audit log has no automatic deletion. To enforce a records-retention policy, run the query manually after institutional approval:

```sql
-- First: count
SELECT COUNT(*) FROM audit_log WHERE created_at < NOW() - INTERVAL '7 years';

-- Then: delete (NOT reversible)
BEGIN;
DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL '7 years';
-- Review rowcount
COMMIT;
```

Consider exporting to cold storage before deletion:

```bash
docker exec aif-db psql -U aif -d aif -c "COPY (
  SELECT * FROM audit_log WHERE created_at < NOW() - INTERVAL '7 years'
) TO STDOUT WITH CSV HEADER" > audit-log-archive-$(date +%F).csv
```

## Tool Deletion

Tool deletion is a separate operation from retention. Admins can delete tools via `DELETE /api/registry/tools/:id`. Migration 008 makes deletion cascade to:

- `pipeline_runs`
- `agent_results`
- `pass_results`
- `pipeline_metrics`
- `notifications` (where `tool_id` matches)
- Associated review records

The audit entry for the delete is preserved. The tool's ID remains referenced in `audit_log.entity_id` as a historical record.

## Pipeline Output Volume

The `aif_output` Docker volume holds agent output files: JSON findings, generated markdown, .docx, .xlsx. These are **not** touched by the retention job. They accumulate indefinitely.

Typical size per run: 2-5 MB. For deployments with many runs per week, consider a separate cleanup:

```bash
# Delete output directories older than 90 days
docker exec aif-app find /data/output -mindepth 1 -maxdepth 1 -type d -mtime +90 -exec rm -rf {} +
```

Verify against `pipeline_runs.output_dir` before deleting if you need to preserve reports for specific runs.

## Related

- [Pipeline Analytics](pipeline-analytics.md) — what's lost after pass_results purge
- [Audit Log](audit-log.md) — audit log is report-only
- [Backup and Restore](backup-restore.md) — back up before large purges
