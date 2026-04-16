# Registry

Routes mounted under `/aif/api/registry`. The registry is the canonical list of submitted tools. Endpoints are role-scoped: each caller sees a different projection of the table depending on their role.

The sandbox toggle is part of the registry surface and is documented here rather than as a separate resource.

## Role-Scoped Visibility

| Role | `GET /registry` returns |
|------|-------------------------|
| Unauthenticated | Active, non-sandboxed tools only |
| `builder` | Own tools (all statuses) plus active/approved non-sandboxed tools from others |
| `reviewer` | All non-sandboxed tools |
| `admin` | All tools, including sandboxed |

Sandboxed tools are always private: only the owner and admins can view them individually.

## Status State Machine

The `tools.status` column is a finite-state machine. Transitions are constrained by both the current status and the caller's role. The table below shows valid transitions.

| From | System | builder | reviewer | admin |
|------|--------|---------|----------|-------|
| `draft` | | → `pending` | | → `pending` |
| `pending` | → `in_progress` | | | → `in_progress` |
| `in_progress` | → `under_review`, `active` | | | → `under_review`, `active` |
| `under_review` | | | → `approved`, `changes_requested` | → `approved`, `changes_requested`, `active` |
| `approved` | | | → `active` | → `active` |
| `changes_requested` | | → `pending` | | → `pending` |
| `active` | | → `retired` | → `under_review`, `suspended` | → `under_review`, `suspended`, `retired` |
| `suspended` | | | → `under_review` | → `under_review`, `active` |

Transitions driven by the pipeline (for example, `pending` → `in_progress` when a run starts) use the `system` column and are triggered by the orchestrator, not by user API calls.

## Endpoints

### GET /registry

Lists tools, role-scoped. Paginated.

**Auth**: Public (returns only active, non-sandboxed tools to unauthenticated callers).

**Query parameters**:

| Name | Type | Default | Notes |
|------|------|---------|-------|
| `page` | integer | 1 | 1-based page number |
| `limit` | integer | 50 | Max 100 |
| `track` | integer | — | Filter to Track 1, 2, 3, or 4 |
| `status` | string | — | Filter by status (whitelisted; unknown values ignored) |

**Response** `200 OK`:

```json
{
  "tools": [
    {
      "id": "0c3f...",
      "name": "Student Dashboard",
      "status": "active",
      "track": 3,
      "weighted_percentage": 48.32,
      "sandbox": false,
      "owner_id": 42,
      "owner_netid": "jdoe",
      "owner_name": "Jane Doe",
      "last_run_at": "2026-04-12T18:00:00Z",
      "...": "..."
    }
  ],
  "total": 127,
  "page": 1,
  "limit": 50
}
```

**Errors**:

- `500 Internal Server Error` — `Failed to load registry`

### GET /registry/:id

Returns a single tool with its pipeline run history.

**Auth**: Authenticated. Builders may only view own tools or active/approved tools; sandboxed tools are visible only to owner and admins.

**Path parameters**:

| Name | Type | Description |
|------|------|-------------|
| `id` | uuid | Tool ID |

**Response** `200 OK`:

```json
{
  "tool": {
    "id": "0c3f...",
    "name": "Student Dashboard",
    "status": "active",
    "track": 3,
    "owner_id": 42,
    "owner_netid": "jdoe",
    "owner_name": "Jane Doe",
    "score_security": 2,
    "score_accessibility": 1,
    "score_data_sensitivity": 3,
    "score_blast_radius": 2,
    "score_autonomy": 1,
    "score_comprehension": 2,
    "score_maintenance": 2,
    "weighted_percentage": 48.32,
    "escalation_conditions": [],
    "sandbox": false,
    "codebase_path": "/data/codebases/0c3f.../src",
    "codebase_url": null,
    "intake_answers": { "q1": "internal-app", "...": "..." },
    "review_decision": null,
    "created_at": "2026-04-01T12:00:00Z",
    "updated_at": "2026-04-12T18:00:00Z"
  },
  "runs": [
    {
      "id": "a1b2...",
      "tool_id": "0c3f...",
      "status": "completed",
      "track": 3,
      "queued_at": "2026-04-12T17:40:00Z",
      "started_at": "2026-04-12T17:41:00Z",
      "completed_at": "2026-04-12T18:00:00Z"
    }
  ]
}
```

**Errors**:

- `401 Unauthorized` — `Authentication required`
- `403 Forbidden` — `Access denied`
- `404 Not Found` — `Tool not found`

### PATCH /registry/:id

Edits basic tool metadata (name, description). Owner or admin.

**Auth**: Owner or admin. **CSRF**: Required.

**Path parameters**:

| Name | Type | Description |
|------|------|-------------|
| `id` | uuid | Tool ID |

**Request body**: At least one of the following must be present.

| Field | Type | Constraints |
|-------|------|-------------|
| `name` | string | 1–200 characters |
| `description` | string \| null | Max 2000 characters |

```json
{ "name": "Student Dashboard v2", "description": "Updated summary." }
```

**Response** `200 OK`:

```json
{ "tool": { "...": "..." } }
```

**Errors**:

- `400 Bad Request` — validation failure (`name: ...`, `description: ...`, or `No fields to update`)
- `403 Forbidden` — caller is not owner and not admin
- `404 Not Found` — `Tool not found`

### PATCH /registry/:id/status

Transitions a tool between statuses. The server validates the transition against the state machine and the caller's role. A ownership check allows tool owners to exercise the `builder` transitions for their own tools even if their current role is higher.

**Auth**: Authenticated. **CSRF**: Required.

**Request body**:

| Field | Type | Constraints |
|-------|------|-------------|
| `status` | string | Target status (see state machine) |

```json
{ "status": "pending" }
```

**Response** `200 OK`:

```json
{ "tool": { "id": "0c3f...", "status": "pending", "...": "..." } }
```

**Errors**:

- `400 Bad Request` — `status: status is required`
- `401 Unauthorized` — `Authentication required`
- `403 Forbidden` — `Cannot transition from '<from>' to '<to>' with role '<role>'`
- `404 Not Found` — `Tool not found`

### PATCH /registry/:id/sandbox

Toggles the tool's sandbox flag. Sandboxed tools are hidden from all other users (owner and admins excepted) and cannot be activated until the flag is cleared. Useful during early iteration when the tool should not surface in the public registry.

**Auth**: Owner or admin. **CSRF**: Required.

**Request body**:

| Field | Type | Constraints |
|-------|------|-------------|
| `sandbox` | boolean | Required |

```json
{ "sandbox": true }
```

**Response** `200 OK`:

```json
{ "tool": { "id": "0c3f...", "sandbox": true, "...": "..." } }
```

**Errors**:

- `400 Bad Request` — `sandbox: Required` (missing or wrong type)
- `401 Unauthorized` — `Authentication required`
- `403 Forbidden` — `Only the owner or an admin can change sandbox mode`
- `404 Not Found` — `Tool not found`

### DELETE /registry/:id

Permanently deletes a tool. All child rows cascade: `pipeline_runs`, `agent_results`, `pass_results`, `pipeline_metrics`, `review_notes`, `finding_statuses`, and `notifications` are removed.

**Auth**: Owner or admin. **CSRF**: Required.

**Response** `200 OK`:

```json
{ "ok": true }
```

**Errors**:

- `403 Forbidden` — caller is not owner and not admin
- `404 Not Found` — `Tool not found`

## Related

- [intake.md](intake.md) — how tools enter the registry
- [pipeline.md](pipeline.md) — running the agent pipeline (drives `pending` → `in_progress` → `under_review`)
- [review.md](review.md) — review decisions that consume `under_review` status
- [overview.md](overview.md) — CSRF header requirements
