# Pipeline Analytics

The Pipeline Analytics tab exposes per-model performance, cost tracking, success rates, and time-series trends for the agent pipeline. Analytics data is stored in `pass_results` and `pipeline_metrics`, populated live during pipeline execution.

## Accessing

Admin Dashboard → Pipeline Analytics tab. Alternatively, the underlying endpoints are available directly under `/aif/api/analytics/*` for programmatic consumption.

## Time Period

Data can be scoped to 30, 90, 180, or 365 days via the Period selector. Queries use `make_interval(days => $1)` with bounds `[1, 365]` enforced server-side.

## Summary Cards

Five top-level metrics:

| Card | Source | Formula |
|------|--------|---------|
| Total Runs | `pipeline_runs` | `COUNT(*)` in period |
| Success Rate | `pipeline_runs` | `completed / total` |
| Avg Duration | `pipeline_runs` | `AVG(completed_at - started_at)` for completed runs |
| Total Cost | `pipeline_metrics` | `SUM(estimated_cost_usd)` |
| Avg Cost/Run | `pipeline_metrics` | `AVG(estimated_cost_usd)` |

Success rate under 80% highlights in warning color. Max per-pass durations over 300 seconds highlight as slow.

## Cost Estimates

Cost is estimated per pass using a fixed per-model rate in `backend/src/pipeline/queue.js`:

```javascript
const MODEL_COST_USD = {
  "codex":   0.30,   // GPT-5.4 via Codex CLI (pass 1)
  "minimax": 0.10,   // MiniMax M2.5 via OpenRouter (pass 2)
  "mimo":    0.06,   // MiMo-V2-Flash via OpenRouter (pass 3)
  "kimi":    0.12,   // Kimi K2 via OpenRouter (pass 4)
  "glm":     0.08,   // GLM-5 via OpenRouter (pass 5)
  "gemini":  0.15,   // Gemini 3.1 Pro Preview (Agent 4 guides)
  "claude":  0.45,   // Claude Opus 4.6 (synthesis + Agent 4)
};
```

A complete pipeline run is approximately:

- 1 Codex pass: $0.30
- 4 OpenRouter passes: $0.36
- 4 Claude synthesis + HECVAT calls: $1.80

Rough total: **$2.46 per run**.

These rates are approximate and based on typical token usage (~100K input, ~10K output per pass). Update `MODEL_COST_USD` in `queue.js` when model pricing changes. Historical estimates are not recomputed — each run's estimate is fixed at the time the run completed.

## Model Performance Comparison

The main visualization is a bar chart of average pass duration per model, with max duration as a faded overlay and median as a white vertical line. Each bar is labeled with the average duration and success rate.

| Model | Typical avg duration | Notes |
|-------|---------------------|-------|
| Codex | 7-10 min | Consistently the slowest. Full filesystem exploration. |
| MiniMax | 1-2 min | Direct API, pre-bundled codebase |
| MiMo | 1-2 min | Flash variant, fastest of passes 2-5 |
| Kimi | 2-3 min | K2 model, longer context processing |
| GLM | 1-2 min | GLM-5, stable |

A large gap between average and max for a model suggests occasional tail latency — usually transient API issues at the upstream provider.

## Per-Model Detail Table

Below the chart, a table shows for each model:

| Column | Description |
|--------|-------------|
| Model | Short name |
| Runs | Total passes attempted in period |
| OK | Completed successfully |
| Fail | Failed (timeout, API error, etc.) |
| Avg Time | Average elapsed seconds |
| Min / Max | Duration range |
| Timeouts | Passes that hit the per-model timeout |
| Parse Fail | Completed passes whose JSON output failed to parse |

Timeouts and parse failures are the two canary metrics. Consistent timeouts mean the per-model timeout in `cli.js` is too aggressive or the upstream model is degraded. Consistent parse failures mean the model is ignoring the structured output schema; check `direct-api.js` response_format handling.

## Run Status Breakdown

Three counts side-by-side:

- Completed (green)
- Failed (red)
- Cancelled (warning color)

Plus average retries per run. Retries > 0.3 indicates the pipeline is habitually retrying — investigate error_category in `pass_results`.

## Pass-Level Statistics

Pass-level aggregates:

| Metric | Meaning |
|--------|---------|
| Total Passes | Across all runs in period |
| Success Rate | `completed / total` |
| Avg Pass Time | Across successful passes |
| JSON Parse Fails | Passes that completed but produced unparseable JSON |
| Avg Attempts | Including retries. 1.0 = no retries. |
| Median Duration | Median per-run duration |

## Trends Chart

A three-part time-series chart (daily for ≤30d, weekly for longer):

1. **Runs** — green bars for completed, red overlay for failed.
2. **Avg Duration** — blue bars.
3. **Cost per Period** — gold bars.

Buckets are driven server-side: `date_trunc('day', queued_at)` for periods ≤ 30 days, `date_trunc('week', ...)` for longer. Gaps indicate no pipeline activity in that bucket.

## Recent Runs Table

The 20 most recent pipeline runs with inline metrics:

| Column | Description |
|--------|-------------|
| Tool | Tool name |
| Track | Track badge (1-4) |
| Status | Run status (completed/failed/cancelled) |
| Duration | Total elapsed time |
| Models | Success ratio, e.g. `4/5` |
| Cost | Estimated cost for this run |
| When | Relative time |

Clicking a row is not wired — to drill into a specific run, call:

```
GET /aif/api/analytics/run/:runId
```

## Drill-Down Endpoints

### Overview

```
GET /aif/api/analytics/overview?days=90
```

Full aggregate — runs, cost, passes, per-model stats, recent runs.

### Per-Model

```
GET /aif/api/analytics/model/:modelName?limit=50&offset=0
```

Pass-level history for one model including error_category breakdown:

```json
{
  "passes": [ ... ],
  "total": 142,
  "limit": 50,
  "offset": 0,
  "errorBreakdown": [
    {"error_category": "timeout", "count": 5},
    {"error_category": "api_error", "count": 2}
  ]
}
```

### Per-Run

```
GET /aif/api/analytics/run/:runId
```

Gantt-style data: run summary, per-agent timings, per-pass timings, aggregate metrics. Use for debugging a specific slow or failed run.

### Trends

```
GET /aif/api/analytics/trends?days=90
```

Returns `timeSeries` (all-model aggregates) and `modelTrends` (per-model per-period).

## Data Lifecycle

Pass-level data in `pass_results` is retained for **90 days by default**. See [Data Retention](data-retention.md). Aggregated `pipeline_metrics` are **never deleted** and serve as a long-term record of cost and performance.

Queries against `pass_results` that span more than 90 days will return incomplete data. Use `pipeline_metrics` joins for long-horizon analysis.

## Exporting

Analytics data is not exportable from the UI. For offline analysis:

```bash
docker exec aif-db psql -U aif -d aif -c "COPY (
  SELECT pr.id AS run_id, pr.track, pr.queued_at, pm.total_elapsed_seconds,
         pm.estimated_cost_usd, pm.models_succeeded, pm.models_failed
  FROM pipeline_runs pr
  JOIN pipeline_metrics pm ON pr.id = pm.run_id
  WHERE pr.queued_at >= NOW() - INTERVAL '90 days'
) TO STDOUT WITH CSV HEADER" > pipeline-runs.csv
```

## Related

- [System Dashboard](system-dashboard.md) — higher-level summary
- [Data Retention](data-retention.md) — pass_results retention rules
- [Troubleshooting](troubleshooting.md) — interpreting timeouts, parse failures, API errors
