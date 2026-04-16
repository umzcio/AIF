# Notifications

Routes mounted under `/aif/api/notifications`. Notifications are delivered both in-app (displayed by the `NotificationBell` component) and, when enabled, by email. Each user controls their own delivery preferences.

All endpoints require authentication. Notifications are strictly scoped to the authenticated user; there is no admin override for reading other users' notifications.

## Notification Events

The following event types are emitted by other endpoints:

| Type | Emitted by |
|------|------------|
| `pipeline_complete` | Pipeline orchestrator on terminal state |
| `review_approved` | `POST /review/:toolId/decision` (decision = approved) |
| `review_changes_requested` | `POST /review/:toolId/decision` (decision = changes_requested) |
| `track_override` | `POST /review/:toolId/track-override` |
| `comment` | `POST /review/:toolId/notes` |
| `tool_activated` | `POST /review/:toolId/activate` or `/self-certify` |

## Endpoints

### GET /notifications

Returns the caller's notifications, newest first, together with the current unread count.

**Auth**: Authenticated.

**Query parameters**:

| Name | Type | Default | Notes |
|------|------|---------|-------|
| `limit` | integer | 30 | Max 100 |
| `offset` | integer | 0 | — |
| `unread` | string | — | When `"true"`, returns only unread notifications |

**Response** `200 OK`:

```json
{
  "notifications": [
    {
      "id": "9e4a...",
      "user_id": 42,
      "tool_id": "0c3f...",
      "tool_name": "Student Dashboard",
      "type": "review_approved",
      "title": "\"Student Dashboard\" has been approved",
      "body": "Findings addressed; ready to activate.",
      "link": "#/tool/0c3f...",
      "read": false,
      "created_at": "2026-04-14T21:15:00Z"
    }
  ],
  "unread_count": 3
}
```

**Errors**:

- `401 Unauthorized` — `Authentication required`

### PATCH /notifications/read

Marks one or more notifications as read. The server accepts either a list of UUIDs or the literal string `"all"` to mark every unread notification for the caller.

**Auth**: Authenticated. **CSRF**: Required.

**Request body**:

| Field | Type | Constraints |
|-------|------|-------------|
| `ids` | `"all"` or UUID array | Array must contain 1+ valid UUIDs |

```json
{ "ids": ["9e4a...", "4c21..."] }
```

or

```json
{ "ids": "all" }
```

**Response** `200 OK`:

```json
{ "success": true, "unread_count": 1 }
```

**Errors**:

- `400 Bad Request` — validation failure (`ids: Invalid input`)
- `401 Unauthorized` — `Authentication required`

### GET /notifications/preferences

Returns the caller's email address and delivery toggles.

**Auth**: Authenticated.

**Response** `200 OK`:

```json
{
  "email": "jdoe@example.edu",
  "notify_email": true,
  "notify_in_app": true
}
```

`email` may be `null` if the user has not configured one and no default could be derived from their netid + institution domain.

### PATCH /notifications/preferences

Updates the caller's notification preferences. At least one of `notify_email` or `notify_in_app` must be present; partial updates are supported.

**Auth**: Authenticated. **CSRF**: Required.

**Request body**:

| Field | Type | Notes |
|-------|------|-------|
| `notify_email` | boolean | Enable or disable email delivery |
| `notify_in_app` | boolean | Enable or disable in-app delivery |

```json
{ "notify_email": false }
```

**Response** `200 OK`:

```json
{ "success": true }
```

**Errors**:

- `400 Bad Request` — `No valid preferences provided` (neither field supplied)
- `400 Bad Request` — validation failure (`notify_email: Expected boolean`)
- `401 Unauthorized` — `Authentication required`

### PATCH /notifications/email

Updates the caller's email address. Email is used solely for notification delivery; it is not an identity credential. Passing an empty string clears the stored address.

**Auth**: Authenticated. **CSRF**: Required.

**Request body**:

| Field | Type | Constraints |
|-------|------|-------------|
| `email` | string | Valid email address, or empty string to clear |

```json
{ "email": "jane.doe@example.edu" }
```

**Response** `200 OK`:

```json
{ "success": true }
```

**Errors**:

- `400 Bad Request` — `email: Invalid email`
- `401 Unauthorized` — `Authentication required`

## Delivery Semantics

- A notification is stored in the `notifications` table whenever `notify()` or `notifyRole()` fires, regardless of the user's `notify_in_app` preference. The preference controls whether the bell surfaces the notification in the UI.
- Email delivery is attempted only when the user has `notify_email = true`, has a non-null `email`, and SMTP is configured on the server.
- Email delivery failures are logged but do not block the triggering operation.
- Read notifications older than 30 days are pruned by the data retention job (see [admin.md](admin.md)).

## Related

- [review.md](review.md) — source of most notifications
- [admin.md](admin.md) — retention and cleanup
- [overview.md](overview.md) — CSRF rules for state-changing requests
