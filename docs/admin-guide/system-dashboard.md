# System Dashboard

The Overview tab of the Admin Dashboard summarizes the current state of the portal: tool counts, pending review queue, recent pipeline activity, and recent audit entries. It is the default view when an admin navigates to `/aif/#/admin`.

## Accessing the Dashboard

Navigate to `#/admin` while authenticated as an admin. The frontend gates the route; unauthenticated or non-admin users see a 404-style message.

## Summary Cards

Four cards at the top of the Overview tab show aggregate counts:

| Card | Source query | Notes |
|------|-------------- |-------|
| Total Tools | `SELECT COUNT(*) FROM tools` | Includes drafts, retired, and all statuses |
| Pending Reviews | `COUNT(*) WHERE status IN ('under_review','changes_requested')` | Highlighted in warning color if > 0 |
| Pipeline Runs (30d) | `COUNT(*) FROM pipeline_runs WHERE queued_at > NOW() - INTERVAL '30 days'` | Includes failed and cancelled runs |
| Active Users | `COUNT(*) FILTER (WHERE is_active) / COUNT(*)` | Format: active / total |

The "Pending Reviews" card is the single most important operational signal. A growing value indicates review bottleneck.

## Tools by Track

A four-column breakdown of tools by their assigned track. Tools without a track (drafts, unsubmitted) are excluded.

| Column | Description | Color |
|--------|-------------|-------|
| Track 1 | Register & Go | Green |
| Track 2 | Self-Certify | Gold |
| Track 3 | IT Review | Orange |
| Track 4 | Formal Project | Red |

A track skew (for example, most tools landing in Track 3-4) may indicate that builders are misjudging data sensitivity or blast radius, or that the institution is genuinely handling higher-risk AI work.

## Tools by Status

Inline badges showing the count of tools in each workflow status:

| Status | Meaning |
|--------|---------|
| `draft` | Intake started, not submitted |
| `pending` | Submitted, pipeline not yet run |
| `in_progress` | Pipeline running |
| `under_review` | Pipeline complete, reviewer action needed |
| `approved` | Reviewer approved, not yet activated |
| `active` | Live in registry |
| `changes_requested` | Reviewer returned to builder |
| `suspended` | Temporarily disabled |
| `retired` | End of life |

Status transitions are enforced by the state machine in `backend/src/routes/registry.js`. See the main project documentation for the transition graph.

## Recent Activity

The bottom of the Overview tab shows the 20 most recent audit log entries:

```
YYYY-MM-DD HH:MM:SS  actor_netid  action  entity_type/entity_id_prefix
```

This is a quick scan of who has done what recently. For full filtering and pagination, use the Audit Log tab. See [Audit Log](audit-log.md).

## Data Source

The dashboard hits a single endpoint:

```
GET /aif/api/admin/dashboard
```

Response shape:

```json
{
  "totalTools": 47,
  "pendingReviews": 3,
  "recentPipelineRuns": 12,
  "totalUsers": 34,
  "activeUsers": 32,
  "byTrack": {"1": 18, "2": 14, "3": 11, "4": 4},
  "byStatus": {"draft": 2, "active": 30, "under_review": 3, ...}
}
```

All counts are computed live at request time. There is no caching. For large deployments (tens of thousands of tools), consider adding indexes on `tools(status)` and `tools(track)`. Migration 007 adds these.

## Review Queue

The "Pending Reviews" count is the review queue size. There is no dedicated "review queue" page; reviewers use the Registry page filtered by status `under_review`.

To see who owns the pending reviews:

```sql
SELECT t.name, t.track, t.updated_at, u.netid AS owner
FROM tools t
JOIN users u ON t.owner_id = u.id
WHERE t.status IN ('under_review', 'changes_requested')
ORDER BY t.updated_at;
```

Oldest `updated_at` first — this is the review SLA signal.

## Using the Dashboard for Operations

### Daily

Check:

1. Pending Reviews card — is it growing?
2. Recent Activity — any unexpected admin actions?
3. Tools by Status — any stuck in `in_progress` for > 1 hour? (These are likely hung or crashed pipelines.)

### Weekly

Review:

1. Pipeline Runs (30d) trend. Drop to zero could indicate a broken pipeline or API key expiry.
2. Track distribution. Shifts may indicate framework drift.
3. Active Users ratio. Deactivate departed users promptly.

### On Incident

If a user reports a problem:

1. Check Recent Activity for their netid.
2. If their tool is stuck, drill into `#/tool/:id` to see the pipeline state.
3. Check [Audit Log](audit-log.md) with the user as actor filter.
4. Check [Pipeline Analytics](pipeline-analytics.md) for recent model failures.

## Related

- [Pipeline Analytics](pipeline-analytics.md) — deeper pipeline metrics
- [Audit Log](audit-log.md) — full filtering and pagination
- [Troubleshooting](troubleshooting.md) — stuck tools and hung pipelines
