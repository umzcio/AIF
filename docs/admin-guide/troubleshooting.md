# Troubleshooting

Common failure modes and how to diagnose them. Categories: pipeline failures, authentication, database, documentation generation, and general operational issues.

## Pipeline Failures

### Symptom: Pipeline stuck in `running` for > 1 hour

**Diagnosis:**

```bash
docker exec aif-db psql -U aif -d aif -c "
  SELECT id, tool_id, current_agent, started_at, NOW() - started_at AS elapsed
  FROM pipeline_runs
  WHERE status = 'running' ORDER BY started_at;
"
```

**Causes and fixes:**

- Container crashed or was restarted. On next startup, `recoverOnStartup()` in `backend/src/pipeline/queue.js` marks all `running` rows as `failed`. If the container has been up for a while without this triggering, the run is genuinely hung.
- A subprocess (Codex, Claude Code, etc.) is not responding. Find it inside the container and kill:

```bash
docker exec aif-app ps auxf
# Look for codex, claude, node CLI subprocesses
docker exec aif-app kill -TERM <pid>
```

- Cancel via UI or API:

```bash
curl -X POST https://example.edu/aif/api/pipeline/$RUN_ID/cancel \
  -H "x-csrf-token: $CSRF" --cookie "aif_token=$JWT; aif_csrf=$CSRF"
```

### Symptom: Pass 1 (Codex) times out

Codex CLI has a 15-minute timeout. On very large codebases or slow upstream API, it can hit the limit.

**Diagnosis:**

```bash
docker exec aif-db psql -U aif -d aif -c "
  SELECT model_name, error_category, COUNT(*)
  FROM pass_results WHERE status = 'failed'
  GROUP BY model_name, error_category;
"
```

**Fixes:**

- Bundle is too large: check the codebase directory size. Exclude `node_modules`, `.venv`, vendored libraries.
- API slowness: retries will happen automatically (up to 1 retry per pass).
- Persistent: increase timeout in `backend/src/agents/shared/cli.js`.

### Symptom: JSON parse failures on passes 2-5

Passes 2-5 use direct OpenRouter API with a strict JSON schema (`response_format`). Some models fail to emit valid JSON under load.

**Diagnosis:**

```sql
SELECT model_name, COUNT(*) AS parse_fails
FROM pass_results
WHERE status = 'completed' AND json_parsed = false
GROUP BY model_name;
```

**Fixes:**

- `direct-api.js` implements a 3-tier fallback: json_schema → json_object → plain JSON extraction. If a specific model consistently fails all three, verify the model ID is still valid on OpenRouter.
- Re-run the pipeline (manual retry from UI).

### Symptom: All passes 2-5 fail with API error

Usually means `OPENROUTER_API_KEY` is missing, invalid, or rate-limited.

**Diagnosis:**

```bash
docker exec aif-app env | grep OPENROUTER
docker logs aif-app | grep -i openrouter | tail -20
```

**Fixes:**

- Verify the key works: `curl -H "Authorization: Bearer $KEY" https://openrouter.ai/api/v1/models`
- Check OpenRouter dashboard for rate limits or balance.
- Update `backend/.env` and restart: `docker compose up -d --force-recreate app`.

### Symptom: Claude synthesis (Agent 1-3) fails

Claude is invoked via Claude Code CLI.

**Diagnosis:**

```bash
docker exec aif-app env | grep ANTHROPIC
docker logs aif-app | grep -i claude | tail -20
```

**Fixes:**

- Verify `ANTHROPIC_API_KEY` is valid.
- Ensure the container includes the Claude Code CLI: `docker exec aif-app which claude`. Should be present from the Dockerfile `npm install -g @anthropic-ai/claude-code` step.
- For nested Claude sessions: `delete process.env.CLAUDECODE` is handled in `cli.js`. If you see "Claude Code is already running" errors, that env var has leaked through.

### Symptom: Pipeline completes but report shows "No findings"

Usually caused by Agent 1-3 synthesis returning an empty array because all passes failed or all passes disagreed.

**Diagnosis:** Check the Analytics → Per-Run view for that run ID. If all 5 passes failed, the synthesis has nothing to work with.

**Fix:** Retry the pipeline. If it repeatedly produces no findings, inspect `pipeline_runs.output_dir`:

```bash
docker exec aif-app ls /data/output/<run-dir>/agent1_code_analysis/
```

Look for per-pass JSON files. If they are missing or tiny, the models are not responding.

### Symptom: Runs stuck in `queued` indefinitely

The queue processor (`processNext()` in `queue.js`) is a single-flight in-process loop. If it crashes or hangs, queued runs sit forever.

**Diagnosis:**

```sql
SELECT COUNT(*) FROM pipeline_runs WHERE status = 'queued';
```

**Fix:** Restart the app container. `recoverOnStartup()` will trigger `processNext()`:

```bash
docker compose restart app
```

## Authentication Issues

### Symptom: User sees login loop

CAS or OIDC callback redirects back to login without establishing a session.

**Diagnosis:**

- Check reverse proxy is passing `X-Forwarded-Proto: https` and `Host` headers.
- Check `CAS_SERVICE_URL` / `OIDC_REDIRECT_URI` matches the actual callback URL including the `/aif` path prefix.
- Verify `FRONTEND_URL` ends with a trailing slash and uses HTTPS.
- Check browser cookies. If `aif_token` is missing after CAS callback, the set-cookie failed — usually because `secure: true` was set but the request came over plain HTTP.

### Symptom: "CSRF token mismatch" on POST/PATCH/DELETE

**Diagnosis:** Frontend's `x-csrf-token` header does not match the `aif_csrf` cookie.

**Fixes:**

- The frontend reads `aif_csrf` via `document.cookie`. If the cookie's `path` does not match the request path, the browser won't send it. Verify `path: BASE_PATH` in `server.js` matches the URL prefix.
- Cross-domain scenarios: the `sameSite: "lax"` cookie may not be sent on top-level navigations from external domains.
- After deploying, have users hard-refresh to get a fresh CSRF cookie.

### Symptom: First user not created as admin

The first-user check is `SELECT COUNT(*) FROM users`. If any rows exist (e.g. migration seed, manual insert, prior test logins), new users will default to `builder`.

**Fix:** Manually promote:

```sql
UPDATE users SET role = 'admin' WHERE netid = 'your-netid';
```

### Symptom: `ADMIN_NETIDS` change not taking effect

`ADMIN_NETIDS` is consulted only on user creation. Existing users keep their role.

**Fix:** Manually promote via UI (Users tab) or SQL (above).

### Symptom: JWT errors after upgrade

```
JsonWebTokenError: invalid signature
```

The `JWT_SECRET` changed. All existing tokens are invalidated.

**Fix:** Users need to log in again. The error resolves on next successful login.

## Database Issues

### Symptom: `Database unreachable` preflight error

**Diagnosis:**

```bash
docker compose ps
docker logs aif-db
docker exec aif-db pg_isready -U aif
```

**Fixes:**

- db container not started: `docker compose up -d db`.
- `DB_PASSWORD` in .env does not match what postgres initialized with. On first startup, postgres bakes the password into the data volume. Changing `DB_PASSWORD` later has no effect unless you also update it inside postgres:

```bash
docker exec aif-db psql -U aif -d aif -c "ALTER USER aif WITH PASSWORD '<new>'"
```

- Volume corruption: see [Backup and Restore](backup-restore.md).

### Symptom: Migration failed

```
FAILED: relation "tools" already exists
```

A previous migration was partially applied, or a manual SQL edit conflicts.

**Diagnosis:**

```sql
SELECT name, applied_at FROM _migrations ORDER BY name;
```

**Fix:**

- If the migration's intended change already exists, mark it applied manually:

```sql
INSERT INTO _migrations (name) VALUES ('0NN_failing.sql');
```

- If not, fix the schema state to match expectations before restarting.

### Symptom: Pool exhaustion

Logs show:

```
error: Client has encountered a connection error and is not queryable
```

The default pool size is `max: 10` (see `backend/src/db/pool.js`). Under sustained load (many concurrent SSE streams each holding a client for notifications) this can exhaust.

**Fix:** Increase pool max in `pool.js` or investigate long-held connections. SSE streams should not hold DB clients for the lifetime of the stream.

## Pandoc / Documentation Failures

Agent 4 generates three markdown documents and invokes `pandoc` to convert them to .docx.

### Symptom: .docx files not produced

**Diagnosis:**

```bash
docker exec aif-app which pandoc
docker exec aif-app ls /data/output/<run-dir>/agent4_documentation/
```

**Fixes:**

- Verify pandoc is installed in the image (it should be, per Dockerfile `apt-get install ... pandoc`).
- The markdown source file is empty or malformed — inspect the .md files in the run's output dir.
- Run pandoc manually to see the error:

```bash
docker exec aif-app pandoc -o /tmp/test.docx /data/output/<run-dir>/agent4_documentation/USER_GUIDE.md
```

### Symptom: HECVAT .xlsx not produced

Agent 4 writes `hecvat_assessment.json` then calls `xlsx-export.js` to merge into the template at `/app/hecvat415.xlsx`.

**Diagnosis:**

```bash
docker exec aif-app ls -la /app/hecvat415.xlsx
docker exec aif-app ls /data/output/<run-dir>/agent4_documentation/
```

**Fixes:**

- Template missing — check `HECVAT_TEMPLATE_PATH` env var and the Dockerfile COPY step.
- Template was overwritten with a different version — restore from repo.
- JSON malformed — inspect `hecvat_assessment.json` and re-run the pipeline.

## Reverse Proxy / Networking

### Symptom: 502 Bad Gateway

nginx or similar cannot reach the app container.

**Fixes:**

- App container not running: `docker compose ps`.
- Firewall on host: `ss -tlnp | grep 3300` should show the app listening.
- Reverse proxy config uses wrong port: AIF listens on host port 3300.

### Symptom: SSE pipeline progress events delayed or never arrive

Proxy is buffering.

**Fix:** See `proxy_buffering off;` and long `proxy_read_timeout` in [Deployment](deployment.md).

### Symptom: Cookies not set / user not logged in

Proxy dropping `Set-Cookie` or missing `X-Forwarded-Proto`.

**Fix:** Configure proxy to forward all response headers and set `X-Forwarded-Proto: https`.

## Build and Image Issues

### Symptom: `docker compose up --build` fails

**Common causes:**

- Frontend `npm install` fails: check Node version compatibility (Node 22).
- `npm install -g @openai/codex` fails: npm registry reachability.
- Semgrep install fails: requires Python 3 and network. Can remove from Dockerfile if not using deterministic SAST.

### Symptom: Container keeps restarting

```bash
docker logs aif-app | tail -50
```

Look for:

- `Preflight failed` — fix config, restart.
- `DATABASE_URL not set` — check `.env` is loaded.
- `Failed to start` — fatal startup error.

Under `restart: unless-stopped`, Docker will retry indefinitely. Stop the container to inspect:

```bash
docker compose stop app
```

## General Debugging

### Reproduce a specific run

```bash
docker exec -it aif-app bash
cd /app/backend
node src/index.js /path/to/test/codebase TRACK_3
```

This runs the full pipeline against a codebase without the HTTP layer, useful for isolating orchestrator issues.

### Inspect the run output directory

```bash
RUN_ID=<uuid>
docker exec aif-app bash -c "ls -la /data/output/*${RUN_ID}*/"
docker exec aif-app cat /data/output/*${RUN_ID}*/agent1_code_analysis/synthesis.json | jq .
```

### Enable debug logging

Set `LOG_LEVEL=debug` in `.env` and restart the app. Remember to revert after debugging — debug output is verbose and can consume the log rotation buffer quickly.

## Related

- [Monitoring](monitoring.md) — what normal logs look like
- [Deployment](deployment.md) — initial deployment checklist
- [Backup and Restore](backup-restore.md) — recovering from data corruption
- [Pipeline Analytics](pipeline-analytics.md) — per-run drill-down
