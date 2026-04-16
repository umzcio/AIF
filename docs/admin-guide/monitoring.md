# Monitoring

AIF exposes a health check endpoint, emits structured JSON logs to container stdout/stderr, and writes pipeline state to the database. This document covers operational monitoring: health checks, log format, key log events, and integration with external observability systems.

## Health Check

```
GET /aif/api/health
```

No authentication. Returns:

```json
{
  "status": "ok",
  "database": "connected",
  "uptime": 3421
}
```

On database failure:

```json
{
  "status": "error",
  "database": "disconnected",
  "error": "connection refused"
}
```

HTTP status: 200 on healthy, 503 on DB failure.

The healthcheck:

- Runs a `SELECT 1` against the connection pool.
- Reports uptime in seconds.
- Is exempt from CSRF and rate limiting.
- Is the target of Docker's built-in healthcheck (every 15s).

Use this endpoint for:

- Load balancer health checks
- Kubernetes liveness/readiness probes (if deploying outside Docker Compose)
- External uptime monitoring (Pingdom, UptimeRobot, etc.)

## Docker Healthcheck

Defined in `docker-compose.yml`:

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/aif/api/health"]
  interval: 15s
  timeout: 5s
  retries: 3
  start_period: 30s
```

Inspect with:

```bash
docker inspect --format='{{.State.Health.Status}}' aif-app
# healthy | unhealthy | starting

docker inspect --format='{{json .State.Health}}' aif-app | jq .
```

When the container becomes unhealthy, Docker does not automatically restart it under `restart: unless-stopped`. Wrap with an external monitor or switch to `restart: on-failure` with a supervisor for auto-restart on health failure.

## Database Healthcheck

The db container uses `pg_isready -U aif` on a 5s interval. The app container's `depends_on: db.condition: service_healthy` ensures the app does not start until the DB is accepting connections.

## Structured JSON Logs

The logger at `backend/src/logger.js` emits one JSON object per line:

```json
{"level":"info","time":"2026-03-11T15:42:17.231Z","msg":"Server listening","service":"aif","port":"3000","basePath":"/aif"}
```

| Field | Purpose |
|-------|---------|
| `level` | `debug`, `info`, `warn`, `error` |
| `time` | ISO-8601 UTC |
| `msg` | Human-readable event |
| `service` | Always `aif` |
| Context fields | Added via `log.child({ runId, agentKey, ... })` |

Stream routing:

- `info` and `debug` → stdout
- `warn` and `error` → stderr

### Log Level

Set `LOG_LEVEL` in `.env`:

| Value | Emits |
|-------|-------|
| `debug` | Everything |
| `info` | Default. Normal operations. |
| `warn` | Warnings and errors |
| `error` | Errors only |

## Key Log Events

Events worth alerting on:

| Message | Level | Meaning | Action |
|---------|-------|---------|--------|
| `Preflight failed` | error | Missing env var or DB unreachable at startup | Check `.env`, DB container |
| `Preflight warnings` | warn | Missing pipeline key, SMTP unreachable, HECVAT template missing | Non-fatal, but pipeline or email may fail |
| `Preflight OK` | info | Startup successful. Includes auth mode, email status, pipeline key count | Confirms healthy startup |
| `Server listening` | info | App ready to accept traffic | Normal |
| `Shutdown initiated` | info | SIGTERM or SIGINT received | Expected on docker stop |
| `Pipeline run ended` (status=failed) | error | A run failed | Investigate via analytics per-run endpoint |
| `Recovered stale running pipelines` | info | Startup found runs marked `running` from a crashed prior process | Expected on unclean restart |
| `Pass retry` | warn | A pipeline pass is being retried | Up to 1 retry per pass is normal; repeated retries suggest API instability |
| `Failed to start` | error | Fatal startup failure | Container will exit |

## Viewing Logs

### Docker CLI

```bash
# Tail live
docker logs -f aif-app

# Last 200 lines
docker logs --tail 200 aif-app

# With timestamps (Docker-injected, separate from internal time)
docker logs -t aif-app

# JSON-parse errors and warnings only
docker logs aif-app 2>&1 | jq 'select(.level == "error" or .level == "warn")'

# All pipeline errors in last hour
docker logs --since 1h aif-app 2>&1 | jq 'select(.msg | test("Pipeline"))'
```

### docker-compose

```bash
docker compose logs -f --tail 100 app
docker compose logs -f db
```

## Log Rotation

Docker's json-file driver rotates logs per container:

| Container | Max per file | Max files | Total cap |
|-----------|--------------|-----------|-----------|
| `aif-app` | 50 MB | 5 | 250 MB |
| `aif-db` | 20 MB | 3 | 60 MB |

Rotated logs are at `/var/lib/docker/containers/<id>/<id>-json.log.N`. Under high activity, the 250 MB app buffer holds approximately 3-7 days of logs at default verbosity.

## Log Aggregation

### Filebeat / Elastic

Filebeat can read the Docker json-file output and forward to Elasticsearch. Example config:

```yaml
filebeat.inputs:
  - type: container
    paths:
      - /var/lib/docker/containers/*/*.log
    processors:
      - add_docker_metadata: ~
      - decode_json_fields:
          fields: ["message"]
          target: "json"
```

Filter on `json.service: aif` to isolate AIF logs.

### Promtail / Loki

```yaml
scrape_configs:
  - job_name: aif
    static_configs:
      - labels:
          job: aif
          __path__: /var/lib/docker/containers/*aif-app*/*-json.log
    pipeline_stages:
      - docker: {}
      - json:
          expressions:
            level: level
            msg: msg
            runId: runId
      - labels:
          level:
```

### Vector

Vector can ingest Docker logs with `source.docker_logs` and parse the embedded JSON.

### Syslog

Change the Docker logging driver to `syslog`:

```yaml
logging:
  driver: syslog
  options:
    syslog-address: "udp://syslog.example.edu:514"
    tag: aif-app
```

## Metrics

AIF does not expose a Prometheus endpoint. Key metrics are available via SQL queries against the analytics tables. For scrape-style integration, write a small exporter that queries `pipeline_metrics` and formats as Prometheus exposition.

Example query for scraper:

```sql
SELECT
  COUNT(*) FILTER (WHERE status = 'completed') AS pipeline_runs_completed,
  COUNT(*) FILTER (WHERE status = 'failed') AS pipeline_runs_failed,
  COUNT(*) FILTER (WHERE status = 'cancelled') AS pipeline_runs_cancelled,
  COUNT(*) FILTER (WHERE status = 'running') AS pipeline_runs_running,
  COUNT(*) FILTER (WHERE status = 'queued') AS pipeline_runs_queued
FROM pipeline_runs WHERE queued_at > NOW() - INTERVAL '1 hour';
```

## Alerting Recommendations

| Condition | Severity | Why |
|-----------|----------|-----|
| Healthcheck fails > 2 min | Critical | Site down |
| `level=error` rate > 5/min | Warning | Something is going wrong |
| `Preflight failed` on startup | Critical | Configuration error |
| No `Pipeline run ended` events for > 24 hours when queued_at > 0 | Warning | Queue stuck |
| `pipeline_runs.status = 'running'` older than per-model timeout total (~45 min) | Warning | Hung run |
| Disk usage on volumes > 80% | Warning | Grow before full |
| DB connection pool exhaustion (errors in logs) | Warning | Capacity issue |

## Volume Monitoring

Check Docker volume sizes:

```bash
# aif_output and aif_codebases grow with pipeline runs
docker system df -v | grep aif_

# From host
du -sh /var/lib/docker/volumes/aif_output/_data
du -sh /var/lib/docker/volumes/aif_codebases/_data
du -sh /var/lib/docker/volumes/aif_pgdata/_data
```

## Related

- [Deployment](deployment.md) — health check wiring
- [Troubleshooting](troubleshooting.md) — interpreting error logs
- [Pipeline Analytics](pipeline-analytics.md) — query-based metrics
