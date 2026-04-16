# Security Architecture

## Summary

The portal's security posture rests on four principles: validate every
untrusted input, isolate every subprocess, audit every write, and refuse to
start with a broken configuration. There is no third-party auth library, no
session store, no raw shell invocation, and no path string concatenation for
sensitive operations. This document enumerates the threat model and the
control surface — each control is referenced by file and line so reviewers
can verify that the control exists in the code rather than in prose.

## Threat Model

| Threat | Asset | Primary control |
|--------|-------|-----------------|
| CSRF from a malicious site | State-changing endpoints | Double-submit cookie + `sameSite=lax` |
| Stolen session token | User session | `httpOnly`, `secure`, path-scoped cookie; 24 h JWT expiry |
| Prompt injection exfiltrating API keys | Pipeline model outputs | `filteredEnv(tool)` — each CLI only sees its own key |
| Malicious codebase via upload or git clone | Filesystem, subprocess | `validateUrl()`, `validateExtractedPaths()`, `--ignore-scripts` |
| Path traversal in archive | Filesystem | Extracted paths verified under `destDir` before use |
| Shell injection via URL/path | Subprocess | `execFileSync`/`spawn` with array args, never a shell string |
| Command injection via intake fields | Subprocess | Intake fields never reach a subprocess |
| Brute force / credential stuffing | Auth endpoints | Rate limit 30 / 15 min on `/auth/*` |
| DoS via large body or slow client | Backend | 1 MB JSON body cap, 500 MB upload cap, SSE event-count cap |
| Unauthorized data access | Tools, runs, reports | RBAC + role-scoped queries + `requireOwnerOrRole()` |
| Containment of the Node process | Host | Non-root container user, read-only mounts where practical |

## Network-level Controls

### HTTP Security Headers (helmet)

`backend/src/server.js:36-49` configures helmet with a tightened Content
Security Policy:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data:;
  connect-src 'self';
  frame-ancestors 'none';
```

`'unsafe-inline'` is tolerated only for style because the frontend uses
inline style objects driven by `constants.js`; scripts are always
bundle-loaded. Helmet also sets HSTS (default 180 days), X-Content-Type-
Options: nosniff, X-Frame-Options: DENY (via `frame-ancestors 'none'`), and
Referrer-Policy.

### TLS

TLS is terminated at the nginx reverse proxy. The backend sets
`app.set("trust proxy", 1)` (`server.js:33`) so `req.ip`, `req.secure`, and
rate-limit key extraction honor `X-Forwarded-*`. Cookies are issued with
`secure: true` which requires HTTPS in the browser.

### Rate Limiting

Two tiers (`server.js:92-93`):

```
/aif/api/auth/*    30 requests / 15 minutes
/aif/api/*        120 requests / minute
```

`express-rate-limit` uses the in-process memory store. For a single replica
this is sufficient; a multi-replica deployment would need a shared store.

### Body Size

Plain JSON requests are capped at 1 MB (`server.js:51`). Multipart uploads
route through `multer` with a 500 MB hard cap
(`routes/intake.js:10`, `routes/pipeline.js:13`).

## CSRF Protection

The double-submit cookie pattern at `server.js:57-89`:

```
On every request:
  if aif_csrf cookie missing → issue 24h cookie with 24-byte random token
On state-changing request (POST/PUT/PATCH/DELETE):
  exempt /auth/login, /auth/callback, /stream, /health
  require x-csrf-token header OR _csrf form field == aif_csrf cookie
  else 403 { error: "CSRF token mismatch" }
```

The cookie is not `httpOnly` because JavaScript has to read it to submit the
header. This is the standard double-submit trade-off: an attacker site
cannot read the cookie (same-origin policy) so cannot forge the header. The
cookie is scoped to `BASE_PATH` to prevent leakage across apps on the same
domain.

## Authentication

See [auth-providers.md](./auth-providers.md) for the five provider
implementations. Controls specific to this file:

- `JWT_SECRET` is required at startup — `backend/src/auth/jwt.js:3-7` calls
  `process.exit(1)` if absent, with an instruction to generate one via
  `crypto.randomBytes(32).toString("hex")`.
- Tokens are HS256-signed; verification enforces `issuer: "aif-portal"` and
  `audience: "aif-users"` (`jwt.js:34-38`). Cross-environment token reuse is
  rejected.
- Cookies: `httpOnly: true`, `secure: true`, `sameSite: "lax"`, `path: BASE_PATH`,
  `maxAge: 86400 * 1000` (`routes/auth.js:11-14`).
- `AUTH_PROVIDER=bypass` is blocked in production (`middleware.js:9-12`).

## RBAC

Three roles enforced by two middleware factories:

```js
requireRole("reviewer", "admin")
requireOwnerOrRole("admin")          // allows tool owner OR listed roles
```

Sources: `backend/src/auth/middleware.js:33-56`. Registry list queries are
additionally **role-scoped at the SQL level**
(`backend/src/routes/registry.js:46-57`):

```sql
-- builder: own tools + active/approved non-sandbox
WHERE (t.owner_id = $user OR (t.status IN ('active','approved') AND t.sandbox = false))

-- reviewer: all non-sandbox
WHERE t.sandbox = false

-- unauthenticated: active non-sandbox only
WHERE t.status = 'active' AND t.sandbox = false

-- admin: no scope
```

## Input Validation

`backend/src/validation.js` defines Zod schemas that are applied via a
`validate(schema)` middleware to every state-changing route. Any mismatch
produces a 400 with a path-scoped error list. Schemas in use include:
`reviewDecisionSchema`, `trackOverrideSchema`, `reviewNoteSchema`,
`toolStatusSchema`, `userRoleSchema`, `userActiveSchema`,
`notificationReadSchema`, `notificationPrefsSchema`, `emailUpdateSchema`,
`pipelineRunSchema`, `toolEditSchema`, `sandboxToggleSchema`,
`findingStatusSchema`. The validated, cleaned payload is read from
`req.validated`.

## Subprocess Isolation

### Environment Filtering

Every CLI tool invocation filters `process.env` so only the variables it
genuinely needs are visible (`backend/src/agents/shared/cli.js:30-50`):

```
codex   → OPENAI_API_KEY only
gemini  → GEMINI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY only
claude  → ANTHROPIC_API_KEY only; CLAUDECODE intentionally unset for nesting
qwen    → OPENROUTER_API_KEY only
(tools) → no API keys at all (toolEnv())
```

Consequence: a prompt-injected Codex session cannot exfiltrate the Anthropic
key, and a malicious Semgrep rule cannot read any LLM key.

### Archive Extraction

`backend/src/utils/extract.js` uses `execFileSync` (array args, no shell) for
`unzip`, `tar xzf`, `tar xf`. After extraction, `validateExtractedPaths()`
walks every entry and verifies `resolve(destDir, entry).startsWith(realDest)`
before the path is exposed to downstream code. This closes the classic
`../../../etc/passwd` archive attack.

### Git Clone

`backend/src/pipeline/queue.js:20-36`:

```js
function validateUrl(url) {
  if (!url.startsWith("https://")) throw ...
  if (/[;|&`$()\n\r]/.test(url)) throw ...   // shell metachar reject
  if (GIT_ALLOWED_HOSTS) {
    const hostname = new URL(url).hostname.toLowerCase();
    if (!GIT_ALLOWED_HOSTS.includes(hostname)) throw ...
  }
}
```

The clone itself is `execFileSync("git", ["clone", "--depth", "1", url, dest])`
with a 120 s timeout — `execFileSync` does not invoke a shell, so even if
the validator missed a metachar, it would reach `git` literally. The
allow-list is opt-in via `GIT_ALLOWED_HOSTS`.

### Codebase Path Pinning

The orchestrator re-resolves and verifies the codebase path at run-start
(`backend/src/pipeline/queue.js:214-218`):

```js
const resolvedCodebase = resolve(codebasePath);
const resolvedBase = resolve(CODEBASES_DIR);
if (!resolvedCodebase.startsWith(resolvedBase + "/") &&
    resolvedCodebase !== resolvedBase) {
  throw new Error(`Codebase path outside allowed directory: ${resolvedCodebase}`);
}
```

This is defense-in-depth: even if a bug allowed a `../`-laced path into the
database, the pipeline would refuse to scan it.

### Sandbox Modes

- **Codex**: `--dangerously-bypass-approvals-and-sandbox` is intentional
  because the pipeline supervises a known prompt. Future work is to move
  Codex to `--sandbox read-only` + `--full-auto`.
- **Claude Code CLI**: runs with `--allowedTools Read,Glob,Grep,Bash(cat:*,ls:*,head:*,tail:*,wc:*,find:*,grep:*)`.
  Write tools (Edit, Write), network fetch, and unrestricted Bash are
  explicitly **not** allowed.
- **Deterministic tools**: `npm install --ignore-scripts` to prevent
  lifecycle execution when synthesizing a missing `package-lock.json`
  (`backend/src/agents/code-analysis/dep-audit.js:60`).

## Cancellation and Resource Cleanup

Every pipeline run has an `AbortController` whose signal is passed to every
CLI invocation and every `fetch`. On cancel the runtime:

1. Aborts the controller (in-flight awaits reject).
2. Sends `SIGTERM` to each tracked child process.
3. After 5 seconds, sends `SIGKILL` as a fallback
   (`backend/src/agents/shared/cli.js:83-94`).
4. Marks DB rows `cancelled` inside a transaction so the registry and the
   pipeline tables never disagree (`pipeline/queue.js:128-141`).

## Audit Logging

`backend/src/audit.js` writes to `audit_log` with `actor_id`, `actor_netid`,
`action`, `entity_type`, `entity_id`, and a JSONB `details` blob. The
middleware populates `req.user.ip` from `req.ip` on every authenticated
request (`auth/middleware.js:72, 81`), and `auditFromReq()` helpers wire
that into the `details` field. Logged events include: tool create/edit,
status change, track override, review decision, user role change, pipeline
start/cancel/retry, data retention sweep.

## Startup Safety

`preflight()` in `backend/src/server.js:137-188`:

- **Fatal if missing**: `JWT_SECRET` (via `jwt.js`), `DATABASE_URL`, DB
  round-trip success.
- **Warn-only**: `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`
  (pipeline passes will fail but the portal still functions for non-pipeline
  flows), HECVAT template missing, SMTP configured but unreachable.
- **Logged at startup**: auth mode, SMTP status, pipeline key count.

## Container Hardening

The multi-stage Dockerfile runs the backend under a non-root user. The
`docker-compose.yml` applies:

- `restart: on-failure`
- Resource limits: 8 GB / 4 CPU for the app, 1 GB for Postgres
- Log rotation (json-file driver)
- No default Postgres password (env var required)
- HECVAT XLSX template + codex `auth.json` are written via Node at startup
  rather than shell-piped into place

Data mounts (`/data/codebases`, `/data/output`) are persistent named
volumes. The frontend build (`frontend/dist`) is served from within the
backend container so there is no separate static server to patch.

## Known Limitations

- **Single-replica rate limit store**: scaling to multiple backend
  containers would require a shared rate-limit store (Redis).
- **Bypass auth existence in production builds**: the bypass provider
  refuses to authenticate in production but the code path is still compiled
  in. A container-level `AUTH_PROVIDER=bypass` + `NODE_ENV=production` is
  logged as an error and then ignored.
- **Semgrep rule sets are pinned at runtime**: updates flow in via the
  `semgrep` package itself, not a rule-pinning mechanism.
- **Snyk requires SNYK_TOKEN** — when absent, CVE analysis relies on
  `npm audit` / `pip-audit` alone.

## Cross-references

- CSRF token flow and the CSRF-exempt route list: [backend.md](./backend.md)
- Auth provider specifics (CAS, header, OIDC, SAML): [auth-providers.md](./auth-providers.md)
- Pipeline abort signal propagation: [pipeline-internals.md](./pipeline-internals.md)
- Subprocess configuration for deterministic tools: [deterministic-tools.md](./deterministic-tools.md)
