# Audit Log

Every state-changing administrative action and review decision is recorded in the `audit_log` table. The log is append-only, filterable from the UI, and never automatically deleted. It is the authoritative record of who did what.

## What Is Logged

The audit writer lives in `backend/src/audit.js`. Callers pass an action, entity type, entity ID, and a details object. The source IP is automatically included. Typical entries include:

| Action | Entity type | Triggered by |
|--------|-------------|--------------|
| `change_role` | `user` | Admin changes a user's role |
| `activate_user` | `user` | Admin reactivates a user |
| `deactivate_user` | `user` | Admin deactivates a user |
| `submit_intake` | `tool` | Builder submits the intake form |
| `update_intake` | `tool` | Builder updates a draft |
| `delete_tool` | `tool` | Admin deletes a tool |
| `review_approved` | `tool` | Reviewer approves a tool |
| `review_changes_requested` | `tool` | Reviewer requests changes |
| `track_override` | `tool` | Reviewer or admin changes a tool's track |
| `self_certify` | `tool` | Track 2 builder self-certifies |
| `activate_tool` | `tool` | Tool moved to `active` status |
| `run_retention` | `system` | Admin triggers retention job |
| `pipeline_cancel` | `pipeline_run` | User cancels a pipeline run |
| `pipeline_retry` | `pipeline_run` | User retries a failed run |

This list is not exhaustive. Any route that mutates data via `logAudit()` or `auditFromReq()` contributes entries.

## Table Schema

```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id INTEGER REFERENCES users(id),
  actor_netid VARCHAR(50),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

| Column | Purpose |
|--------|---------|
| `actor_id` | Foreign key to `users.id`. Null for system actions. |
| `actor_netid` | Copied at write time. Persists even if the user is later deleted. |
| `action` | Short snake_case action name. |
| `entity_type` | `tool`, `user`, `pipeline_run`, `system`, etc. |
| `entity_id` | String form of the affected record's primary key. |
| `details` | JSONB blob with action-specific payload. Always includes `ip` when writer had access to the request. |
| `created_at` | UTC timestamp, auto-populated. |

`actor_netid` is copied rather than joined so that audit history remains intact even if a user is renamed or deleted.

## Details Payload

The `details` JSONB column typically includes:

- `ip` — source IP (always, when available)
- Action-specific fields

Examples:

```json
// change_role
{"from": "builder", "to": "reviewer", "targetNetid": "alice", "ip": "10.1.2.3"}

// review_approved
{"note": "LGTM", "track": 3, "ip": "10.1.2.3"}

// track_override
{"fromTrack": 2, "toTrack": 3, "reason": "Handles student records", "ip": "10.1.2.3"}

// run_retention
{"passResults": {"deleted": 142, "dryRun": false}, ...}
```

Do not rely on a specific shape — new actions add new fields over time.

## Viewing via UI

Admin Dashboard → Audit Log tab.

Filters:

| Filter | Type | Matches |
|--------|------|---------|
| Actor | Substring | `actor_netid ILIKE '%value%'` |
| Action | Exact | `action = 'value'` (alphanumeric + underscore only) |
| Entity Type | Exact | `entity_type = 'value'` (alphanumeric + underscore only) |
| From | Date | `created_at >= 'value'` |
| To | Date | `created_at <= 'value'` |

Page size: 50 entries. Paginated by offset.

Timestamps are shown in the browser's local timezone. Server stores UTC.

## Querying via API

```bash
GET /aif/api/admin/audit?actor=alice&entityType=tool&limit=50&offset=0
```

Response:

```json
{
  "entries": [
    {
      "id": "8f9c...",
      "actor_id": 42,
      "actor_netid": "alice",
      "action": "review_approved",
      "entity_type": "tool",
      "entity_id": "71a3-...",
      "details": {"note": "LGTM", "ip": "10.1.2.3"},
      "created_at": "2026-03-11T15:42:17.231Z"
    }
  ],
  "total": 1842,
  "limit": 50,
  "offset": 0
}
```

Query parameters:

| Param | Required | Max |
|-------|----------|-----|
| `actor` | No | any |
| `action` | No | alphanumeric + underscore |
| `entityType` | No | alphanumeric + underscore |
| `from` | No | ISO date |
| `to` | No | ISO date |
| `limit` | No | 100 (clamped) |
| `offset` | No | unbounded |

## Direct SQL Access

For bulk analysis, query the table directly:

```sql
-- All admin actions in the last 30 days
SELECT created_at, actor_netid, action, entity_type, entity_id, details
FROM audit_log
WHERE action IN ('change_role', 'activate_user', 'deactivate_user',
                 'run_retention', 'delete_tool')
  AND created_at > NOW() - INTERVAL '30 days'
ORDER BY created_at DESC;

-- Review activity per reviewer
SELECT actor_netid, action, COUNT(*) AS n
FROM audit_log
WHERE action IN ('review_approved', 'review_changes_requested', 'track_override')
  AND created_at > NOW() - INTERVAL '90 days'
GROUP BY actor_netid, action
ORDER BY actor_netid, action;

-- All changes to a specific tool
SELECT created_at, actor_netid, action, details
FROM audit_log
WHERE entity_type = 'tool' AND entity_id = '<tool-uuid>'
ORDER BY created_at;

-- Source IPs used by a user
SELECT DISTINCT details->>'ip' AS ip, COUNT(*) AS events
FROM audit_log
WHERE actor_netid = 'alice' AND details ? 'ip'
GROUP BY ip
ORDER BY events DESC;
```

## Retention Policy

**Audit log entries are never automatically deleted.**

The retention job (see [Data Retention](data-retention.md)) counts audit entries older than 365 days and reports them in its summary, but does not delete them. To delete old audit entries, run SQL manually after an institutional records-retention decision:

```sql
-- WARNING: Irreversible. Back up first.
DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL '7 years';
```

## Indexes

Migration 007 adds an index on `audit_log(created_at)` to support time-range queries. For filter-heavy deployments, consider adding:

```sql
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_netid);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
```

These are not required by default because the filter set is narrow and the table typically stays under a few hundred thousand rows.

## Integrity Expectations

- The audit log is append-only from the application. No route issues `UPDATE` or `DELETE` against `audit_log`.
- Failed audit writes are logged but do not cause the parent operation to fail. This is deliberate — a DB failure in audit writing should not prevent a user from completing their task, but it may produce gaps in the log.
- Transactional audit writes: when an action has an associated audit entry and a DB mutation, both happen inside the same transaction. See `auditFromReq()` and `withTransaction()` usage in `backend/src/routes/review.js`.

## Integration with SIEM / Log Aggregation

The audit log is not exported to syslog by default. For SIEM integration:

1. Periodically query `SELECT * FROM audit_log WHERE created_at > last_seen`.
2. Ship to the SIEM via its standard ingestion.

Alternatively, structured application logs (see [Monitoring](monitoring.md)) include audit events in JSON format to stdout, which many log shippers can consume directly from Docker's json-file driver.

## Related

- [User Management](user-management.md) — role change and deactivation entries
- [Data Retention](data-retention.md) — audit log is report-only
- [Monitoring](monitoring.md) — structured log shipping
