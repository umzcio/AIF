# Analytics

Routes mounted under `/aif/api/analytics`. All endpoints require the `admin` role and return aggregated pipeline performance data sourced from the `pipeline_runs`, `pass_results`, and `pipeline_metrics` tables.

Cost values are USD estimates computed from per-model token assumptions recorded in `MODEL_COST_USD` (backend `src/pipeline/queue.js`). They are recorded at run completion; changes to the cost table do not retroactively update historical rows.

## Endpoints

### GET /analytics/overview

Aggregate statistics for the pipeline over a configurable window. Intended as the primary admin analytics view.

**Auth**: `admin`.

**Query parameters**:

| Name | Type | Default | Max |
|------|------|---------|-----|
| `days` | integer | 90 | 365 |

**Response** `200 OK`:

```json
{
  "period": { "days": 90 },
  "runs": {
    "total": 150,
    "completed": 138,
    "failed": 8,
    "cancelled": 4,
    "avgDurationSeconds": 1245.6,
    "medianDurationSeconds": 1180.0,
    "avgRetries": 0.07
  },
  "cost": {
    "total": 42.18,
    "avgPerRun": 0.31
  },
  "passes": {
    "total": 2250,
    "completed": 2170,
    "failed": 80,
    "jsonParseFailures": 12,
    "avgSeconds": 210.4,
    "avgAttempts": 1.03
  },
  "models": [
    {
      "name": "gpt-5.4",
      "totalRuns": 450,
      "successes": 441,
      "failures": 9,
      "parseFailures": 2,
      "successRate": 0.98,
      "avgSeconds": 505.1,
      "medianSeconds": 495.0,
      "minSeconds": 310.0,
      "maxSeconds": 890.0,
      "avgOutputBytes": 48210,
      "timeouts": 3,
      "apiErrors": 6
    }
  ],
  "recentRuns": [
    {
      "id": "a1b2...",
      "status": "completed",
      "track": 3,
      "queued_at": "2026-04-12T17:40:00Z",
      "started_at": "2026-04-12T17:41:00Z",
      "completed_at": "2026-04-12T18:00:00Z",
      "retry_count": 0,
      "tool_name": "Student Dashboard",
      "total_elapsed_seconds": 1140,
      "estimated_cost_usd": 0.29,
      "models_succeeded": 5,
      "models_failed": 0,
      "json_parse_failures": 0
    }
  ]
}
```

`recentRuns` is capped at 50 entries and ordered by `queued_at` descending.

### GET /analytics/model/:modelName

Detailed per-pass history for a single model. Pair with `overview.models` to drill into model-level issues.

**Auth**: `admin`.

**Path parameters**:

| Name | Type | Description |
|------|------|-------------|
| `modelName` | string | Model identifier (URL-encode slashes if present, e.g. `gpt-5.4`, `minimax-m2.5`) |

**Query parameters**:

| Name | Type | Default | Max |
|------|------|---------|-----|
| `limit` | integer | 50 | 200 |
| `offset` | integer | 0 | — |

**Response** `200 OK`:

```json
{
  "passes": [
    {
      "id": 9921,
      "run_id": "a1b2...",
      "agent_index": 1,
      "model_name": "gpt-5.4",
      "attempt": 1,
      "status": "completed",
      "elapsed_seconds": 510,
      "output_bytes": 48210,
      "json_parsed": true,
      "error_category": null,
      "track": 3,
      "tool_name": "Student Dashboard",
      "run_status": "completed",
      "created_at": "2026-04-12T17:45:00Z"
    }
  ],
  "total": 450,
  "limit": 50,
  "offset": 0,
  "errorBreakdown": [
    { "error_category": "timeout", "count": 3 },
    { "error_category": "api_error", "count": 6 }
  ]
}
```

`errorBreakdown` is computed across the model's full history, not just the returned page.

**Errors**:

- `403 Forbidden` — `Insufficient permissions`

### GET /analytics/run/:runId

Per-run Gantt-style breakdown: run row, per-agent results, per-pass results, and aggregated metrics.

**Auth**: `admin`.

**Path parameters**:

| Name | Type | Description |
|------|------|-------------|
| `runId` | uuid | Run ID |

**Response** `200 OK`:

```json
{
  "run": {
    "id": "a1b2...",
    "tool_id": "0c3f...",
    "tool_name": "Student Dashboard",
    "status": "completed",
    "track": 3,
    "queued_at": "2026-04-12T17:40:00Z",
    "started_at": "2026-04-12T17:41:00Z",
    "completed_at": "2026-04-12T18:00:00Z",
    "retry_count": 0,
    "output_dir": "/data/pipeline-output/a1b2..."
  },
  "agents": [
    {
      "run_id": "a1b2...",
      "agent_index": 1,
      "agent_name": "Code & Security",
      "status": "completed",
      "started_at": "2026-04-12T17:41:00Z",
      "completed_at": "2026-04-12T17:50:00Z"
    }
  ],
  "passes": [
    {
      "id": 9921,
      "run_id": "a1b2...",
      "agent_index": 1,
      "model_name": "gpt-5.4",
      "attempt": 1,
      "status": "completed",
      "elapsed_seconds": 510,
      "output_bytes": 48210,
      "json_parsed": true,
      "error_category": null,
      "created_at": "2026-04-12T17:45:00Z"
    }
  ],
  "metrics": {
    "run_id": "a1b2...",
    "total_elapsed_seconds": 1140,
    "estimated_cost_usd": 0.29,
    "models_succeeded": 5,
    "models_failed": 0,
    "json_parse_failures": 0
  }
}
```

`metrics` is `null` when the run has not yet completed (or completed before the metrics schema existed).

**Errors**:

- `404 Not Found` — `Run not found`

### GET /analytics/trends

Time-series data bucketed by day (for short windows) or week (for longer windows). Useful for dashboard-style charts.

**Auth**: `admin`.

**Query parameters**:

| Name | Type | Default | Min | Max |
|------|------|---------|-----|-----|
| `days` | integer | 30 | 7 | 365 |

Bucket size is derived automatically: `day` when `days <= 30`, otherwise `week`.

**Response** `200 OK`:

```json
{
  "period": { "days": 30, "bucket": "day" },
  "timeSeries": [
    {
      "period": "2026-04-01T00:00:00Z",
      "runs": 5,
      "completed": 5,
      "failed": 0,
      "avgDuration": 1150.0,
      "totalCost": 1.45,
      "avgCost": 0.29
    }
  ],
  "modelTrends": [
    {
      "period": "2026-04-01T00:00:00Z",
      "model": "gpt-5.4",
      "runs": 5,
      "completed": 5,
      "avgSeconds": 505.0
    }
  ]
}
```

`modelTrends` is emitted once per (period, model) pair. Expect five entries per period when all five pipeline models ran.

## Related

- [pipeline.md](pipeline.md) — how runs are enqueued and populated
- [admin.md](admin.md) — the retention endpoint governs pass/notification archival
