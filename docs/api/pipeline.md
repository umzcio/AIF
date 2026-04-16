# Pipeline

Routes mounted under `/aif/api/pipeline`. The pipeline runs the 4-agent review sequence (Code & Security, Accessibility, QA / Bug Detection, Documentation) against a tool's codebase.

A pipeline run is a first-class resource identified by a UUID. Its lifecycle is:

```
queued → running → completed | failed | cancelled
```

Retries create a new run record linked to the original via `parent_run_id`. After two total failures, a run is pushed to the dead letter queue and may not be retried further.

## Access Control

Three identities are authorized for any given run:

- The owner of the underlying tool.
- Any user with the `reviewer` role.
- Any user with the `admin` role.

Starting a pipeline run requires owner-or-admin, so reviewers cannot unilaterally kick off analysis against someone else's tool.

## Endpoints

### POST /pipeline/:toolId/upload

Uploads a codebase archive and associates it with the tool. The archive is extracted into `CODEBASES_DIR/<toolId>/` and the tool's `codebase_path` column is updated. Use this instead of the intake multipart field when the codebase is provided after the initial submission.

**Auth**: Owner or admin. **CSRF**: Required. (For this multipart request, the token may be passed as a `_csrf` form field.)

**Path parameters**:

| Name | Type | Description |
|------|------|-------------|
| `toolId` | uuid | Target tool |

**Request**: `multipart/form-data` with a `codebase` file field. Accepts `.zip`, `.tar.gz`, `.tar.bz2` up to 500 MB.

**Response** `200 OK`:

```json
{ "codebasePath": "/data/codebases/0c3f.../src" }
```

**Errors**:

- `400 Bad Request` — `No file uploaded`
- `400 Bad Request` — `Failed to extract codebase: <reason>`
- `403 Forbidden` — caller is not owner and not admin
- `404 Not Found` — `Tool not found`

### POST /pipeline/:toolId/run

Enqueues a pipeline run against a tool. The server returns immediately with the new run record; the run executes asynchronously. Callers should connect to `GET /pipeline/:runId/stream` to receive progress events.

**Auth**: Owner or admin. **CSRF**: Required.

**Path parameters**:

| Name | Type | Description |
|------|------|-------------|
| `toolId` | uuid | Target tool |

**Request body**:

| Field | Type | Default | Constraints |
|-------|------|---------|-------------|
| `track` | integer | tool's current track | 1–4 — override the tool's computed track for this run |
| `mode` | string | `"direct-api"` | Pipeline execution mode (currently only `"direct-api"`) |

```json
{ "track": 3, "mode": "direct-api" }
```

**Response** `201 Created`:

```json
{
  "run": {
    "id": "a1b2...",
    "tool_id": "0c3f...",
    "status": "queued",
    "track": 3,
    "queued_at": "2026-04-12T17:40:00Z",
    "retry_count": 0,
    "parent_run_id": null
  }
}
```

**Errors**:

- `400 Bad Request` — validation failure (`track: Number must be less than or equal to 4`, etc.)
- `403 Forbidden` — caller is not owner and not admin
- `404 Not Found` — `Tool not found`
- `500 Internal Server Error` — enqueue failure

### GET /pipeline/:runId

Returns a single run with its agent results. If the run is still queued, the response includes the caller's position in the queue.

**Auth**: Owner, reviewer, or admin.

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
    "status": "running",
    "track": 3,
    "queued_at": "2026-04-12T17:40:00Z",
    "started_at": "2026-04-12T17:41:00Z",
    "completed_at": null,
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
  "queuePosition": null
}
```

`queuePosition` is the 1-based position among queued runs, or `null` if the run is not queued.

**Errors**:

- `401 Unauthorized` — `Authentication required`
- `403 Forbidden` — `Insufficient permissions`
- `404 Not Found` — `Run not found`

### GET /pipeline/:runId/stream

Opens a Server-Sent Events stream for live pipeline progress. This is the canonical way to monitor a running pipeline.

**Auth**: Owner, reviewer, or admin. **CSRF**: Exempt (SSE streams are GET, and path ends in `/stream`).

**Response**: `200 OK` with `Content-Type: text/event-stream`.

The first event sent is always a `state` snapshot containing the current run, agents, queue position, and per-tool model states. Subsequent events mirror the progress bus:

```
data: {"type":"state","run":{...},"agents":[...],"queuePosition":null,"toolStates":{...}}

data: {"type":"agent_start","agent":"Code & Security","agentIndex":1}

data: {"type":"pass_complete","agent":"Code & Security","model":"gpt-5.4","elapsed":420}

data: {"type":"status","status":"completed"}
```

Terminal events (`status: completed | failed | cancelled`) close the stream. Heartbeat comments (`: heartbeat`) are emitted every 30 seconds to keep intermediaries from buffering or timing out.

**Client handling**:

```javascript
const es = new EventSource(`/aif/api/pipeline/${runId}/stream`, { withCredentials: true });
es.addEventListener("message", (e) => {
  const event = JSON.parse(e.data);
  if (event.type === "status" && ["completed","failed","cancelled"].includes(event.status)) {
    es.close();
  }
});
```

**Errors**:

- `401 Unauthorized` — `Authentication required`
- `403 Forbidden` — `Insufficient permissions`
- `404 Not Found` — `Run not found`

### POST /pipeline/:runId/cancel

Cancels a queued or running pipeline. The orchestrator propagates an abort signal to all child processes (Codex, direct OpenRouter API calls, Claude CLI). SIGTERM is sent first; SIGKILL follows if the process does not exit cleanly.

**Auth**: Owner, reviewer, or admin. **CSRF**: Required.

**Response** `200 OK`:

```json
{ "success": true, "processesKilled": 3 }
```

**Errors**:

- `400 Bad Request` — `Cannot cancel a run with status '<status>'` (valid source statuses: `queued`, `running`)
- `401 Unauthorized` — `Authentication required`
- `403 Forbidden` — `Insufficient permissions`
- `404 Not Found` — `Run not found`
- `500 Internal Server Error` — unexpected cancel failure

### POST /pipeline/:runId/retry

Creates a new pipeline run that supersedes the specified failed or cancelled run. The new run's `parent_run_id` points at the original, and `retry_count` is incremented. The original run's row is preserved for audit.

A run may only be retried twice. A third attempt is rejected and the chain is treated as a dead letter.

**Auth**: Owner, reviewer, or admin. **CSRF**: Required.

**Response** `201 Created`:

```json
{
  "run": {
    "id": "b2c3...",
    "tool_id": "0c3f...",
    "status": "queued",
    "parent_run_id": "a1b2...",
    "retry_count": 1
  }
}
```

**Errors**:

- `400 Bad Request` — retry preconditions (e.g. source run not in a retryable state, retry cap reached)
- `401 Unauthorized` — `Authentication required`
- `403 Forbidden` — `Insufficient permissions`
- `404 Not Found` — `Run not found`

## Execution Model

- **Codex CLI (pass 1)** runs with filesystem access to the extracted codebase. Its timeout is 15 minutes.
- **Passes 2–5** receive a deterministically bundled codebase (≤400K characters) and call OpenRouter models (MiniMax, MiMo, Kimi, GLM) with JSON Schema enforcement.
- **Synthesis** uses Claude Code CLI with filesystem access; timeout 15 minutes.
- Partial results are synthesized if 4 of 5 passes succeed.
- Per-pass retry with backoff allows one re-attempt per pass before the pass is marked failed.

## Related

- [reports.md](reports.md) — consuming completed pipeline output
- [analytics.md](analytics.md) — historical pipeline performance and per-run breakdowns
- [registry.md](registry.md) — status transitions driven by pipeline completion
