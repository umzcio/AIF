# Database Architecture

## Summary

The portal uses a single PostgreSQL 16 database. All persistence is via the
`pg` package — there is no ORM, query builder, or migration framework beyond
numbered SQL files applied in order. Fourteen migrations under
`backend/migrations/` define the schema; each migration is idempotent where
practical (`IF NOT EXISTS`, guarded `ALTER`). The connection pool is a
module-level `pg.Pool` (`backend/src/db/pool.js`) with a configurable max
(default 10). Multi-statement writes go through `withTransaction()`, a small
helper that issues `BEGIN`/`COMMIT`/`ROLLBACK` and releases the client in
`finally`.

## Tables

| Table | Purpose | Cascade parent |
|-------|---------|----------------|
| `users` | Authenticated identities (netid unique), role, email, notify prefs, `is_active` | — |
| `tools` | Registry entries — intake answers, scores, track, status, sandbox flag | `owner_id → users.id` (no cascade) |
| `pipeline_runs` | One row per pipeline execution, retry chain via `parent_run_id` | `tool_id → tools.id ON DELETE CASCADE` (migration 008) |
| `agent_results` | Per-agent status within a run (4 rows per run) | `run_id ON DELETE CASCADE` |
| `pass_results` | Per-model pass (≤5 × 3 agents) with attempt number for retries | `run_id ON DELETE CASCADE` |
| `pipeline_metrics` | Aggregate per-run metrics computed on completion | `run_id ON DELETE CASCADE` |
| `review_notes` | Comment thread + status-change annotations per tool | `tool_id ON DELETE CASCADE` |
| `audit_log` | Every write action with actor netid, entity, JSONB details | — (append-only) |
| `notifications` | In-app notifications, read flag, email_sent flag | `user_id`, `tool_id ON DELETE CASCADE` |
| `finding_statuses` | User-set open/resolved/wontfix per finding (migration 010) | `tool_id ON DELETE CASCADE` |

## Migrations

```
001_init.sql                     users, tools, pipeline_runs, agent_results, base indexes
002_add_in_progress_status.sql   widen tools.status to include 'in_progress'
003_rbac_and_review.sql          review_decision columns, review_notes, audit_log, is_active
004_notifications.sql            notifications + users.email/notify_* columns
005_pipeline_retry_cancel.sql    retry_count, cancel_requested, parent_run_id, pass_results
006_pipeline_analytics.sql       pass_results.json_parsed/output_bytes/error_category, pipeline_metrics
007_performance_indexes.sql      tools(owner_id,status), pass_results(model,created_at), etc.
008_cascade_tool_delete.sql      pipeline_runs.tool_id FK gets ON DELETE CASCADE
009_notification_link.sql        notifications.link column; notify_email default -> false
010_finding_statuses.sql         finding_statuses (open|resolved|wontfix)
011_pipeline_mode.sql            pipeline_runs.pipeline_mode (supports mode switching)
012_sandbox.sql                  tools.sandbox BOOLEAN
013_opencode_default.sql         legacy default -> 'opencode'
014_direct_api_default.sql       current default -> 'direct-api'
```

Migrations are applied by a small runner at container start or by hand. There
is no down-migration script by design — reverts happen via a new forward
migration.

## Key Relationships

```
users 1 ──< tools  (owner_id, optional)
users 1 ──< audit_log.actor_id
users 1 ──< notifications.user_id
users 1 ──< review_notes.author_id
users 1 ──< tools.review_decided_by

tools 1 ──< pipeline_runs   (CASCADE since 008)
tools 1 ──< review_notes    (CASCADE)
tools 1 ──< notifications   (CASCADE)
tools 1 ──< finding_statuses (CASCADE)

pipeline_runs 1 ──< agent_results   (CASCADE)
pipeline_runs 1 ──< pass_results    (CASCADE)
pipeline_runs 1 ──  pipeline_metrics (CASCADE, UNIQUE run_id)
pipeline_runs 0,1 ──< pipeline_runs.parent_run_id   (retry chain)
```

## Status State Machine (tools.status)

Enforced at the SQL level via a `CHECK` constraint and at the API level via
a `TRANSITIONS` map in `backend/src/routes/registry.js:14-23`. The SQL
constraint permits any of the nine states; valid **transitions** are policed
in code so role-based rules can be expressed:

```
draft ─ submit ──▶ pending ── queue ──▶ in_progress ─ complete ─┬─▶ under_review ─ approve ─▶ approved ─ activate ─▶ active
                                                                 └─ Track 1 only ───────────────────────────────────────▶ active
under_review ─ changes_requested ─▶ changes_requested ─ resubmit ─▶ pending
active ─ suspend ─▶ suspended ─ reinstate ─▶ under_review
active ─ retire  ─▶ retired
```

Reviewers can escalate an `active` tool back to `under_review` or `suspended`.
Admins have all reviewer transitions plus `retire`. The `system` role is a
synthetic role used when the pipeline itself transitions status (Track 1
auto-activate, `in_progress → under_review` on completion).

## Scores and Escalations

`tools` stores seven dimension scores (0–3 each), a computed weighted
percentage, a track (1–4), and a JSONB array of escalation conditions.
Authoritative computation lives in `backend/src/scoring.js`; the frontend
mirror (`frontend/src/constants.js`) is preview-only. `has_escalation` is a
generated column that is true when the JSONB array is non-empty, enabling
indexed filtering without client-side inspection.

## Pass Results and Retry Model

Every pipeline pass gets a row in `pass_results` keyed uniquely by
`(run_id, agent_name, pass_key, attempt)`. On retry, the previous row is
marked `failed` and a new row with `attempt + 1` is inserted
(`backend/src/pipeline/queue.js:293-307`). Metrics are computed against the
latest attempt per key so a successful retry does not double-count a
failure.

Error categories are constrained:

```sql
error_category CHECK (error_category IN ('timeout', 'parse_error', 'api_error',
                                          'cancelled', 'unknown', NULL))
```

## Indexes

| Index | Source | Rationale |
|-------|--------|-----------|
| `idx_tools_track` | 001 | Registry track filter |
| `idx_pipeline_runs_tool` | 001 | Tool detail page run list |
| `idx_pipeline_runs_status` | 001 | Queue drain, stale recovery |
| `idx_agent_results_run` | 001 | Pipeline view query |
| `idx_notifications_user` | 004 | Bell dropdown (`user_id, read, created_at DESC`) |
| `idx_review_notes_tool` | 003 | Review thread |
| `idx_audit_log_entity` / `_created` | 003 / 007 | Admin audit tab |
| `idx_pass_results_run` | 005 | Per-run analytics |
| `idx_pass_results_model` / `_status` / `_completed` | 006 | Analytics overview |
| `idx_tools_owner_status` | 007 | Builder-scoped registry query |
| `idx_pass_results_model_completed` | 007 | Trend series |
| `idx_pipeline_runs_parent` (partial) | 007 | Retry chain lookup |
| `idx_notifications_user_read` | 007 | Unread badge |
| `idx_pipeline_runs_queued` | 007 | Analytics time range |
| `idx_finding_statuses_tool` | 010 | Finding status lookup |

## Transaction Patterns

`withTransaction()` in `backend/src/db/pool.js:14-27` is the only helper. It
accepts an `async` callback that receives a `pg.PoolClient`. The callback
must pass the client to any helper that writes to the audit log or
notifications table so those writes participate in the same transaction.

Example — review decision in `backend/src/routes/review.js`:

```js
const updated = await withTransaction(async (client) => {
  const { rows: [tool] } = await client.query(
    "SELECT * FROM tools WHERE id = $1 FOR UPDATE", [toolId]);
  // validate transition
  await client.query("UPDATE tools SET status = ... WHERE id = $1", [toolId]);
  await logAudit({ ... }, client);          // joins the same tx
  await insertReviewNote({ ... }, client);
  return tool;
});
```

`SELECT ... FOR UPDATE` pins the row to serialize concurrent reviewer
decisions on the same tool. On any thrown error, `ROLLBACK` runs in a
try/catch so a dead connection does not mask the original error.

### Sites Using Transactions

- Review decision (`routes/review.js`)
- Track override (`routes/review.js`)
- Admin tool delete — relies on cascade FKs
- Pipeline completion — updates run + tool status atomically
  (`pipeline/queue.js:327-336`)
- Pipeline cancel — updates run, agent_results, tool status
  (`pipeline/queue.js:128-141`)

## Connection Pooling

```js
new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || "10"),
});
```

The pool is a module singleton. `pool.end()` runs in the shutdown handler
(`backend/src/server.js:201-203`). Individual queries use `pool.query(sql,
params)`; transactions use `withTransaction()`. Parameters are always passed
as the second argument — there is no string interpolation of user data in
SQL.

## Data Retention

`backend/src/jobs/retention.js` is a manually triggered sweep
(`POST /admin/retention`) with three policies:

1. **pass_results older than 90 days** — archive to `pass_results_archive`
   (if the table exists) then delete.
2. **notifications older than 30 days and `read = true`** — delete.
3. **audit_log** — reported only; no automated pruning because audit records
   must be retained for compliance. Admins decide when and how to export.

## Cross-references

- Status machine rules and role enforcement: [backend.md](./backend.md)
- How pass_results feeds retry and DLQ: [pipeline-internals.md](./pipeline-internals.md)
- Audit log write path and IP capture: [security.md](./security.md)
