# Review

Routes mounted under `/aif/api/review`. Review endpoints drive the approval workflow: reviewers approve or request changes, reviewers or admins may override the computed track, builders may self-certify Track 2 tools, and all parties exchange comments on a tool.

## Role Model

| Action | Role |
|--------|------|
| Read the review queue | `reviewer`, `admin` |
| Approve / request changes | `reviewer`, `admin` |
| Override track | `reviewer`, `admin` |
| Activate an approved tool | `reviewer`, `admin` |
| Self-certify a Track 2 tool | Tool owner (or admin/reviewer acting on their behalf) |
| Read / add notes | Tool owner (own tools) or `reviewer`/`admin` (any tool) |

All state-changing endpoints wrap database writes in a single transaction that updates the tool, inserts a `review_notes` row of the appropriate `note_type`, and appends an `audit_log` entry. A notification is dispatched to the affected parties after the transaction commits.

## Endpoints

### GET /review/queue

Returns tools awaiting review, ordered by `updated_at` ascending (oldest first). Includes owner metadata and the latest pipeline run status so reviewers can prioritize.

**Auth**: `reviewer`, `admin`.

**Response** `200 OK`:

```json
{
  "tools": [
    {
      "id": "0c3f...",
      "name": "Student Dashboard",
      "status": "under_review",
      "track": 3,
      "weighted_percentage": 48.32,
      "owner_netid": "jdoe",
      "owner_name": "Jane Doe",
      "last_run_at": "2026-04-12T18:00:00Z",
      "latest_run_status": "completed"
    }
  ]
}
```

Tools in `under_review` and `changes_requested` statuses are included.

**Errors**:

- `401 Unauthorized` — `Authentication required`
- `403 Forbidden` — `Insufficient permissions`

### POST /review/:toolId/decision

Records an approve-or-request-changes decision on a tool.

**Auth**: `reviewer`, `admin`. **CSRF**: Required.

**Path parameters**:

| Name | Type | Description |
|------|------|-------------|
| `toolId` | uuid | Target tool (must be in `under_review` status) |

**Request body**:

| Field | Type | Constraints |
|-------|------|-------------|
| `decision` | string | `approved` \| `changes_requested` |
| `notes` | string | Optional reviewer notes |

```json
{ "decision": "approved", "notes": "Findings addressed; ready to activate." }
```

**Response** `200 OK`:

```json
{
  "tool": {
    "id": "0c3f...",
    "status": "approved",
    "review_decision": "approved",
    "review_decided_at": "2026-04-14T21:15:00Z",
    "review_decided_by": 17
  }
}
```

**Side effects**:

- A `review_notes` row of type `status_change` is inserted with `from: "under_review"` / `to: <decision>` metadata.
- A notification of type `review_approved` or `review_changes_requested` is sent to the tool owner.
- An `audit_log` entry `review_approved` or `review_changes_requested` is appended.

**Errors**:

- `400 Bad Request` — `Cannot review a tool with status '<status>'`
- `400 Bad Request` — validation failure (`decision: Invalid enum value`)
- `403 Forbidden` — `Insufficient permissions`
- `404 Not Found` — `Tool not found`

### POST /review/:toolId/track-override

Re-routes a tool to a different track. Used when the reviewer disagrees with the computed track (for example, escalating a Track 2 tool that handles sensitive data to Track 4).

**Auth**: `reviewer`, `admin`. **CSRF**: Required.

**Request body**:

| Field | Type | Constraints |
|-------|------|-------------|
| `newTrack` | integer | 1–4 |
| `reason` | string | Required, non-empty; recorded in the audit trail and visible to the owner |

```json
{ "newTrack": 4, "reason": "Tool ingests FERPA-protected data not disclosed in intake." }
```

**Response** `200 OK`:

```json
{
  "tool": {
    "id": "0c3f...",
    "track": 4,
    "updated_at": "2026-04-14T21:20:00Z"
  }
}
```

**Side effects**:

- A `review_notes` row of type `track_override` is inserted with `from: <old>` / `to: <new>` metadata.
- A notification of type `track_override` is sent to the tool owner.
- An `audit_log` entry `track_override` is appended.

**Errors**:

- `400 Bad Request` — validation failure (`newTrack: Number must be less than or equal to 4`, `reason: reason is required`)
- `403 Forbidden` — `Insufficient permissions`
- `404 Not Found` — `Tool not found`

### GET /review/:toolId/notes

Returns the comment thread for a tool, ordered oldest first. Includes `status_change` and `track_override` notes inserted automatically by the decision endpoints.

**Auth**: Authenticated. Builders may only read notes on their own tools.

**Response** `200 OK`:

```json
{
  "notes": [
    {
      "id": 101,
      "tool_id": "0c3f...",
      "author_id": 17,
      "author_netid": "reviewer1",
      "author_name": "Alex Reviewer",
      "body": "Please fix the hardcoded API key before resubmitting.",
      "note_type": "comment",
      "metadata": null,
      "created_at": "2026-04-14T21:15:00Z"
    }
  ]
}
```

**Errors**:

- `401 Unauthorized` — `Authentication required`
- `403 Forbidden` — `Insufficient permissions`
- `404 Not Found` — `Tool not found`

### POST /review/:toolId/notes

Adds a comment to a tool's thread. Comments are of type `comment` (distinct from the automatic `status_change` / `track_override` notes).

**Auth**: Authenticated. Builders may only comment on their own tools. **CSRF**: Required.

**Request body**:

| Field | Type | Constraints |
|-------|------|-------------|
| `body` | string | Required, non-empty (trimmed before insert) |

```json
{ "body": "Updated the secrets handling; please re-review." }
```

**Response** `201 Created`:

```json
{
  "note": {
    "id": 102,
    "tool_id": "0c3f...",
    "author_id": 42,
    "body": "Updated the secrets handling; please re-review.",
    "note_type": "comment",
    "created_at": "2026-04-14T22:00:00Z"
  }
}
```

**Side effects**:

- An `audit_log` entry `add_comment` is appended.
- A notification of type `comment` is sent to the tool owner, unless the commenter is the owner.

**Errors**:

- `400 Bad Request` — `body: body is required`
- `401 Unauthorized` — `Authentication required`
- `403 Forbidden` — `Insufficient permissions`
- `404 Not Found` — `Tool not found`

### POST /review/:toolId/self-certify

Self-certification path for Track 2 tools. The owner reviews the pipeline findings, confirms they have addressed or accepted each one, and transitions the tool directly to `active` without waiting for a reviewer.

Preconditions:

- The tool must be in `track = 2`.
- The tool must be in `status = 'under_review'`.
- The caller must be the tool owner. (Admins may also operate on behalf of a tool; the frontend does not expose this.)

**Auth**: Tool owner. **CSRF**: Required.

**Response** `200 OK`:

```json
{
  "tool": {
    "id": "0c3f...",
    "status": "active",
    "review_decision": "self_certified",
    "review_decided_at": "2026-04-14T22:30:00Z",
    "review_decided_by": 42
  }
}
```

**Side effects**:

- A `review_notes` row of type `status_change` with metadata `{ method: "self_certify" }` is inserted.
- Notifications of type `tool_activated` are sent to all reviewers and admins.
- An `audit_log` entry `self_certify` is appended.

**Errors**:

- `400 Bad Request` — `Self-certification is only for Track 2 tools`
- `400 Bad Request` — `Tool must be under review to self-certify`
- `401 Unauthorized` — `Authentication required`
- `403 Forbidden` — `Only the tool owner can self-certify`
- `404 Not Found` — `Tool not found`

### POST /review/:toolId/activate

Transitions an approved tool to `active` status, making it visible in the public registry.

Preconditions:

- The tool must be in `status = 'approved'`.
- The tool must not be sandboxed. (The sandbox flag is cleared through `PATCH /registry/:id/sandbox` first.)

**Auth**: `reviewer`, `admin`. **CSRF**: Required.

**Response** `200 OK`:

```json
{
  "tool": {
    "id": "0c3f...",
    "status": "active",
    "updated_at": "2026-04-14T22:45:00Z"
  }
}
```

**Side effects**:

- A `review_notes` row of type `status_change` (`approved` → `active`) is inserted.
- A notification of type `tool_activated` is sent to the tool owner.
- An `audit_log` entry `activate` is appended.

**Errors**:

- `400 Bad Request` — `Only approved tools can be activated`
- `400 Bad Request` — `Cannot activate a sandboxed tool. Remove from sandbox first.`
- `403 Forbidden` — `Insufficient permissions`
- `404 Not Found` — `Tool not found`

## Related

- [registry.md](registry.md) — status state machine and sandbox toggle
- [notifications.md](notifications.md) — how decision notifications reach the owner
- [admin.md](admin.md) — audit log view of review actions
