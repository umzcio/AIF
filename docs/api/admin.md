# Admin

Routes mounted under `/aif/api/admin`. All admin endpoints require the `admin` role; callers with any other role receive `403 Forbidden`.

## Endpoints

### GET /admin/dashboard

Returns aggregate counters for the administrative dashboard: total tools, pending reviews, recent pipeline activity, user counts, and distributions by track and status.

**Auth**: `admin`.

**Response** `200 OK`:

```json
{
  "totalTools": 127,
  "pendingReviews": 8,
  "recentPipelineRuns": 42,
  "totalUsers": 34,
  "activeUsers": 31,
  "byTrack": { "1": 40, "2": 35, "3": 30, "4": 22 },
  "byStatus": {
    "draft": 5,
    "pending": 3,
    "in_progress": 2,
    "under_review": 8,
    "approved": 4,
    "active": 95,
    "changes_requested": 3,
    "suspended": 2,
    "retired": 5
  }
}
```

`recentPipelineRuns` counts runs queued in the last 30 days.

**Errors**:

- `403 Forbidden` — `Insufficient permissions`

### GET /admin/users

Lists all users in the system, most recently created first. Each row includes a computed `tool_count` (tools owned by that user).

**Auth**: `admin`.

**Response** `200 OK`:

```json
{
  "users": [
    {
      "id": 42,
      "netid": "jdoe",
      "display_name": "Jane Doe",
      "email": "jdoe@example.edu",
      "role": "builder",
      "is_active": true,
      "notify_email": true,
      "notify_in_app": true,
      "last_login": "2026-04-14T14:00:00Z",
      "created_at": "2026-01-10T09:00:00Z",
      "tool_count": 3
    }
  ]
}
```

### PATCH /admin/users/:id/role

Changes a user's role. Takes effect on the user's next request; existing JWT cookies still reference the old role until the client calls `/auth/refresh`.

**Auth**: `admin`. **CSRF**: Required.

**Path parameters**:

| Name | Type | Description |
|------|------|-------------|
| `id` | integer | User ID |

**Request body**:

| Field | Type | Constraints |
|-------|------|-------------|
| `role` | string | `builder` \| `reviewer` \| `admin` |

```json
{ "role": "reviewer" }
```

**Response** `200 OK`:

```json
{
  "user": {
    "id": 42,
    "netid": "jdoe",
    "role": "reviewer",
    "...": "..."
  }
}
```

**Side effects**: `audit_log` entry `change_role` with `{ from, to, targetNetid }` details and the caller's IP.

**Errors**:

- `400 Bad Request` — `role: Invalid enum value`
- `403 Forbidden` — `Insufficient permissions`
- `404 Not Found` — `User not found`

### PATCH /admin/users/:id/active

Activates or deactivates a user. A deactivated user cannot successfully refresh their session (the cookie is cleared on the next `/auth/refresh`). An admin cannot deactivate themselves.

**Auth**: `admin`. **CSRF**: Required.

**Request body**:

| Field | Type | Constraints |
|-------|------|-------------|
| `active` | boolean | Required |

```json
{ "active": false }
```

**Response** `200 OK`:

```json
{
  "user": {
    "id": 42,
    "netid": "jdoe",
    "is_active": false,
    "...": "..."
  }
}
```

**Side effects**: `audit_log` entry `activate_user` or `deactivate_user` with `{ targetNetid }` details and the caller's IP.

**Errors**:

- `400 Bad Request` — `active: Required`
- `400 Bad Request` — `Cannot deactivate yourself`
- `403 Forbidden` — `Insufficient permissions`
- `404 Not Found` — `User not found`

### GET /admin/audit

Searches the audit log. All filters are optional and combine with `AND`. Results are paginated and ordered by `created_at` descending.

**Auth**: `admin`.

**Query parameters**:

| Name | Type | Notes |
|------|------|-------|
| `actor` | string | Case-insensitive partial match on `actor_netid` (`ILIKE %actor%`) |
| `entityType` | string | Exact match; sanitized to `[a-z_]` |
| `action` | string | Exact match; sanitized to `[a-z_]` |
| `from` | ISO 8601 timestamp | Inclusive lower bound on `created_at` |
| `to` | ISO 8601 timestamp | Inclusive upper bound on `created_at` |
| `limit` | integer | Default 50, max 100 |
| `offset` | integer | Default 0 |

**Response** `200 OK`:

```json
{
  "entries": [
    {
      "id": 1234,
      "actor_id": 17,
      "actor_netid": "reviewer1",
      "action": "review_approved",
      "entity_type": "tool",
      "entity_id": "0c3f...",
      "details": { "from": "under_review", "to": "approved", "notes": "…" },
      "created_at": "2026-04-14T21:15:00Z"
    }
  ],
  "total": 847,
  "limit": 50,
  "offset": 0
}
```

### POST /admin/retention

Runs the data retention job. In default (non-dry-run) mode this:

- Archives `pass_results` older than 90 days.
- Prunes read `notifications` older than 30 days.
- Reports on `audit_log` age (it is preserved indefinitely by default but the age is surfaced so administrators can decide whether to archive externally).

**Auth**: `admin`. **CSRF**: Required.

**Query parameters**:

| Name | Type | Notes |
|------|------|-------|
| `dryRun` | string | When `"true"`, compute counts without deleting |

**Response** `200 OK`:

```json
{
  "passResultsArchived": 120,
  "notificationsDeleted": 50,
  "auditLogOldestDays": 210,
  "dryRun": false
}
```

**Side effects**: `audit_log` entry `run_retention` with the result payload as `details`.

**Errors**:

- `500 Internal Server Error` — retention job failed

## Related

- [auth.md](auth.md) — role-change visibility via `/auth/refresh`
- [analytics.md](analytics.md) — admin-only pipeline performance views
- [overview.md](overview.md) — general request conventions
