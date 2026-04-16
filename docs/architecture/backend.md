# Backend Architecture

## Summary

The backend is a Node.js 20+ Express 4 application written in ESM. It serves a
single HTTP port under a configurable base path (default `/aif`) and exposes
three surfaces: a JSON REST API under `/aif/api/*`, a Server-Sent Events stream
for pipeline progress, and the compiled frontend as static assets. All
dependencies are raw — no ORM, no GraphQL layer, no background worker. State
lives in PostgreSQL; ephemeral pipeline state lives in process memory. The
entry point is `backend/src/server.js`; the process starts by running a
preflight (env vars, DB, HECVAT template, SMTP) and then draining any queued
pipeline runs that were orphaned by a prior restart.

## Module Layout

```
backend/src/
├── server.js                 # Express wiring, middleware stack, preflight, shutdown
├── config.js                 # Institution-specific config from env vars
├── logger.js                 # Structured JSON logger, child contexts
├── scoring.js                # Framework scoring model (dimensions → track)
├── audit.js                  # audit_log writer (accepts optional tx client)
├── notifications.js          # In-app + SMTP notification delivery
├── validation.js             # Zod schemas + validate() middleware factory
├── auth/
│   ├── middleware.js         # JWT verification, requireRole, requireOwnerOrRole
│   ├── jwt.js                # jose-based HS256 sign/verify
│   └── providers/            # Pluggable SSO (see auth-providers.md)
├── db/
│   └── pool.js               # pg.Pool + withTransaction() helper
├── routes/
│   ├── auth.js               # login/callback/logout/status/refresh
│   ├── intake.js             # draft/submit/edit
│   ├── registry.js           # list/detail/status transitions
│   ├── pipeline.js           # run/stream/cancel/retry
│   ├── reports.js            # agent results, file downloads
│   ├── review.js             # decisions, notes, track override
│   ├── admin.js              # dashboard, users, retention
│   ├── analytics.js          # per-model performance + cost
│   └── notifications.js      # CRUD, mark-read, prefs
├── pipeline/
│   ├── queue.js              # In-process queue, retry/DLQ, metrics
│   └── events.js             # EventEmitter SSE bus + per-run state cache
├── orchestrator/
│   └── direct-api.js         # Single active pipeline orchestrator
├── agents/                   # See pipeline-internals.md
├── utils/extract.js          # Archive extraction with path-traversal guard
└── jobs/retention.js         # Data retention sweep (pass_results, notifications)
```

## Express Middleware Stack

The order in `backend/src/server.js:32-122` is load-bearing.

```
1. trust proxy 1                     — respect X-Forwarded-* from nginx
2. helmet(...)                       — CSP, HSTS, X-Frame-Options, Referrer-Policy
3. express.json({ limit: "1mb" })    — body parser with hard cap
4. cookieParser()                    — read aif_token and aif_csrf
5. CSRF double-submit cookie         — issues + verifies aif_csrf on state change
6. rateLimit(auth)                   — 30 / 15min on /aif/api/auth/*
7. rateLimit(api)                    — 120 / 60s on /aif/api/*
8. GET /aif/api/health               — no auth, checks DB round-trip
9. GET /aif/api/config               — no auth, returns institution identity
10. const api = Router()             — all feature routes below here
      api.use(authMiddleware)        — populate req.user from JWT cookie
      api.use("/auth", authRoutes)   — login/callback always passes through
      api.use("/intake", ...)
      api.use("/registry", ...)
      api.use("/pipeline", ...)
      api.use("/reports", ...)
      api.use("/review", ...)
      api.use("/admin", ...)
      api.use("/analytics", ...)
      api.use("/notifications", ...)
11. express.static(frontendDist)     — compiled Vite bundle
12. SPA fallback (GET /aif/*)        — serves index.html for unmatched paths
```

### CSRF Implementation

Rather than a session store, the server uses the double-submit cookie pattern
(`backend/src/server.js:57-89`): on every request it issues an `aif_csrf`
cookie if absent, readable by JavaScript. For any `POST`/`PUT`/`PATCH`/`DELETE`
the server compares the cookie to an `x-csrf-token` header (or a `_csrf` form
field for multipart). Exemptions are narrow: auth login/callback (which are
redirects), SSE streams, and health checks. The CSRF middleware runs **before**
rate limiting because the token issuance must be idempotent even for rejected
requests.

### Auth Middleware

`authMiddleware` (`backend/src/auth/middleware.js:58-94`) is a soft gate: it
reads the JWT from the cookie and sets `req.user` if valid but does not reject
public routes. `isProtectedRoute(req)` then rejects unauthenticated write
attempts and any read of `/intake`, `/pipeline`, `/review`, `/admin`,
`/reports`. `/auth/*` always passes through. Two factory helpers layer on top:

| Middleware | Source | Use case |
|-----------|--------|----------|
| `requireRole("reviewer", "admin")` | `middleware.js:33-39` | Role-gated endpoints |
| `requireOwnerOrRole("admin")` | `middleware.js:41-56` | Builder owns the tool, or has escalated role. Attaches `req.tool` |

## Route Organization

| Prefix | File | Guard | Notes |
|--------|------|-------|-------|
| `/auth/*` | `routes/auth.js` | none | Provider-delegated login, JWT issuance |
| `/intake/*` | `routes/intake.js` | authenticated | Draft/submit, multipart upload, archive extract |
| `/registry/*` | `routes/registry.js` | role-scoped query | Builders see own + active; reviewers see non-sandbox; admins see all |
| `/pipeline/*` | `routes/pipeline.js` | `requireOwnerOrRole("admin")` + `requireRunAccess()` | Run, SSE, cancel, retry |
| `/reports/*` | `routes/reports.js` | `requireRunAccess()` or `requireOwnerOrRole` | Synthesis JSON, finding status |
| `/review/*` | `routes/review.js` | `requireRole("reviewer","admin")` | Decision, notes, override |
| `/admin/*` | `routes/admin.js` | `requireRole("admin")` | Dashboard, user management, retention |
| `/analytics/*` | `routes/analytics.js` | `requireRole("admin")` | Per-model metrics, cost, trends |
| `/notifications/*` | `routes/notifications.js` | authenticated | In-app read/write, email prefs |

### Validation Pattern

Every state-changing route uses the `validate(schema)` factory
(`backend/src/validation.js:4-14`). It runs `schema.safeParse(req.body)`, sends
a 400 with a human-readable path-scoped error list on failure, and attaches
the cleaned payload to `req.validated` on success. Schemas live next to the
factory and are exported by name. Example:

```js
router.post("/:id/decision",
  requireRole("reviewer","admin"),
  validate(reviewDecisionSchema),
  async (req, res) => {
    const { decision, notes } = req.validated;
    /* ... */
  });
```

## Transaction Pattern

Multi-statement writes use `withTransaction()`
(`backend/src/db/pool.js:14-27`). The helper checks out a pool client, issues
`BEGIN`, invokes the callback, and commits on success or rolls back on throw.
The callback receives the client so nested helpers (`audit.js`, `notify()`)
can accept an optional client argument to participate in the same transaction.

Use sites today:
- review decisions (`routes/review.js`)
- status transitions (`routes/registry.js`)
- pipeline completion (status + summary) and cancellation cleanup
  (`pipeline/queue.js:126-141`, `pipeline/queue.js:327-336`)
- admin tool delete (cascades via FKs defined in `008_cascade_tool_delete.sql`)

## Error Handling

The backend does **not** use a global error handler. Each route handles its
own errors:

- Validation errors → 400 from `validate()`
- Auth failures → 401 from `authMiddleware`
- RBAC failures → 403 from `requireRole` / `requireOwnerOrRole`
- Not found → 404 from the route
- Database exceptions → caught per-route, logged via `log.error(...)`, surfaced
  as `500 { error: "message" }`

There is no silent catch-all because stack traces from uncaught Express
middleware would be sent to the client with debug info; each route's explicit
handling keeps the response envelope uniform (`{ error: string }` or
`{ data }`).

### Logging

`backend/src/logger.js` emits structured JSON (one object per line) with
`level`, `ts`, `component`, optional `runId`, and the message's extra fields.
Child contexts (`log.child({ component: "direct-api", runId })`) prefix every
subsequent call. No PII is logged — only netid, tool ID, run ID, and counts.

## Preflight and Lifecycle

```
start()
  └─ preflight()
      ├─ require JWT_SECRET              (jwt.js exits if missing)
      ├─ require DATABASE_URL            (fatal)
      ├─ warn on missing OPENAI_API_KEY, OPENROUTER_API_KEY, ANTHROPIC_API_KEY
      ├─ warn on missing HECVAT template
      ├─ pool.query("SELECT 1")          (fatal on failure)
      └─ verifySmtp() — warn only
  └─ recoverOnStartup()
      ├─ mark 'running' pipeline_runs as 'failed' (server restarted)
      └─ call processNext() if any 'queued' runs remain
  └─ app.listen(PORT)

SIGTERM / SIGINT
  └─ shutdown(signal)
      ├─ server.close()
      ├─ pool.end()
      └─ 30s force-exit fallback
```

## Static Asset Serving

The same Node process serves the Vite `dist/` output under `BASE_PATH` with an
SPA fallback that returns `index.html` for anything the API did not match
(`server.js:125-132`). This collapses deployment to one container; there is no
separate CDN. Long-cache headers are not set by the app — nginx can add them
if needed.

## Cross-references

- Authentication and provider selection: [auth-providers.md](./auth-providers.md)
- Data layer details, indexes, cascade rules: [database.md](./database.md)
- Pipeline queue internals, retry, DLQ: [pipeline-internals.md](./pipeline-internals.md)
- Security controls (CSRF, helmet, rate limit): [security.md](./security.md)
