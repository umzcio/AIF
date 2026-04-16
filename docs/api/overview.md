# API Overview

The AIF HTTP API is a JSON REST interface used by the frontend and available for scripted integration. All application endpoints are mounted under a single base path and share the same authentication, CSRF, and rate-limit regime.

## Base URL

All API endpoints are served under a configurable base path. In the default production deployment, the portal runs behind a reverse proxy that forwards to Express on this prefix:

```
/aif/api
```

The base path is exposed to clients via `GET /aif/api/config` (see below). It is controlled by the `BASE_PATH` environment variable on the server (default `/aif`).

## Authentication

The API uses a JWT session cookie named `aif_token`. The cookie is set by the authentication provider after a successful login and carries the user's `userId`, `netid`, `role`, and `displayName`.

| Attribute | Value |
|-----------|-------|
| Cookie name | `aif_token` |
| HttpOnly | `true` |
| Secure | `true` |
| SameSite | `lax` |
| Path | `BASE_PATH` (e.g. `/aif`) |
| Lifetime | 24 hours |

Callers drive authentication through the `/auth/*` endpoints (see [auth.md](auth.md)). A browser client redirects to `/auth/login` and receives the cookie via the IdP callback. Non-browser clients must either run behind a reverse proxy that forwards a valid cookie or enable header-based authentication on the server side.

Role-based access is enforced at the middleware level. The three roles are `builder`, `reviewer`, and `admin`. Endpoints that require a specific role respond with:

- `401 Unauthorized` — no valid cookie was presented
- `403 Forbidden` — the user's role is insufficient, or ownership is required and the caller does not own the resource

Some endpoints use an "owner or role" policy: the tool's owner is always permitted, as are users with any of the listed roles.

## CSRF

CSRF protection follows the double-submit cookie pattern:

1. On every request, if the cookie `aif_csrf` is missing the server sets it to a random 24-byte hex token.
2. State-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) must echo the cookie back, either through the `x-csrf-token` HTTP header or as a `_csrf` form field on multipart uploads.
3. If the token is missing or does not match, the server returns `403 CSRF token mismatch`.

The following requests are exempt from CSRF enforcement:

- Any request with method `GET`, `HEAD`, or `OPTIONS`
- `/auth/login` and `/auth/callback` (redirect-based SSO flows)
- Server-Sent Events streams (paths ending in `/stream`)
- Health check (`/health`)

The CSRF cookie is **not** `HttpOnly`, so browser JavaScript can read it directly from `document.cookie`.

### Example

```bash
# First GET establishes the CSRF cookie
curl -c cookies.txt https://portal.example.edu/aif/api/config

# Subsequent state-changing request echoes the token
TOKEN=$(grep aif_csrf cookies.txt | awk '{print $7}')
curl -b cookies.txt \
     -H "Content-Type: application/json" \
     -H "x-csrf-token: $TOKEN" \
     -X PATCH \
     -d '{"status":"pending"}' \
     https://portal.example.edu/aif/api/registry/<id>/status
```

## Rate Limiting

Two rate-limit policies are applied as middleware:

| Scope | Window | Limit |
|-------|--------|-------|
| `/auth/*` | 15 minutes | 30 requests |
| All other `/api/*` | 1 minute | 120 requests |

Responses include the standard `RateLimit-*` headers. Exceeding the limit returns `429 Too many requests`.

## Body Size

Requests with a JSON body are capped at **1 MB**. Multipart codebase uploads use a separate limit of **500 MB** enforced by `multer`.

## Error Format

All error responses use this shape:

```json
{ "error": "description of what went wrong" }
```

The HTTP status code carries the semantic meaning. Common statuses across the API:

| Status | Meaning |
|--------|---------|
| 400 | Request body failed validation, or the operation is not valid for the resource's current state |
| 401 | Authentication required or the session token is invalid |
| 403 | CSRF mismatch, insufficient role, or caller is not the resource owner |
| 404 | Resource not found |
| 429 | Rate limit exceeded |
| 500 | Unhandled server error |
| 503 | Health check failed (database unreachable) |

Validation errors concatenate all Zod issues into a single semicolon-separated string, for example:

```json
{ "error": "track: Number must be less than or equal to 4; reason: reason is required" }
```

## Public Endpoints

Two endpoints are always public and require no authentication:

### GET /api/config

Returns institution-specific values the frontend reads at runtime.

```json
{
  "institutionName": "University of Montana",
  "institutionDomain": "umontana.edu",
  "basePath": "/aif"
}
```

### GET /api/health

Returns server health and database connectivity. The frontend does not call this endpoint; it is intended for external monitoring.

```json
{ "status": "ok", "database": "connected", "uptime": 1234 }
```

On database failure the endpoint returns `503`:

```json
{ "status": "error", "database": "disconnected", "error": "..." }
```

## Conventions

- **Content type**: `application/json; charset=utf-8` for all JSON responses. File downloads use appropriate MIME types (`text/csv`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, etc.).
- **Character encoding**: UTF-8 throughout.
- **Timestamps**: ISO 8601 strings in UTC.
- **Identifiers**: Tools and pipeline runs use UUIDs; users use integer primary keys.
- **Pagination**: List endpoints that paginate accept `page` and `limit` query parameters (default `page=1`, `limit=50`, max `limit=100`) and return `{ items, total, page, limit }`.
- **Query parameter sanitization**: Free-text filters on enumerated columns (status, entity type, action) are filtered to `[a-z_]` before being placed in parameterized SQL.

## Request Lifecycle

1. Express parses cookies and JSON body (1 MB cap).
2. CSRF middleware establishes or validates the double-submit token.
3. Rate-limit middleware checks the appropriate bucket.
4. Auth middleware reads the `aif_token` cookie, verifies the JWT, and attaches `req.user` when valid. Protected routes reject unauthenticated callers here.
5. Route handlers run role/ownership checks and Zod validation.
6. State-changing handlers wrap multi-query operations in `withTransaction()` and emit `audit_log` entries.

## Related Documents

- [auth.md](auth.md) — session lifecycle and the `/auth/*` surface
- [intake.md](intake.md) — draft and submission routes
- [registry.md](registry.md) — tool registry, status state machine, sandbox flag
- [pipeline.md](pipeline.md) — pipeline execution and SSE streaming
- [reports.md](reports.md) — agent output retrieval, downloads, finding status persistence
- [review.md](review.md) — review decisions, track overrides, self-certification
- [admin.md](admin.md) — dashboard, user management, audit log, retention
- [analytics.md](analytics.md) — pipeline performance analytics
- [notifications.md](notifications.md) — in-app and email notification management
