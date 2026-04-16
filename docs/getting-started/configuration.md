# Configuration

## Summary

All AIF configuration is supplied through environment variables read from `backend/.env`. The file is loaded by Docker Compose (`env_file: backend/.env`) and made available to the running container. This document groups every variable by purpose, indicates which are required, and states defaults. For provider-specific auth variables, see [authentication-setup.md](authentication-setup.md).

## How configuration is loaded

1. `docker compose up` reads `backend/.env` via the `env_file` directive and injects each key/value pair into the container environment.
2. A subset of variables is re-exported in `docker-compose.yml` under `environment:` to enforce defaults for path-bound settings (`BASE_PATH`, `OUTPUT_DIR`, `CODEBASES_DIR`, `HECVAT_TEMPLATE_PATH`, `DATABASE_URL`).
3. On container start, `backend/src/server.js` runs a preflight check that fails fast if `DATABASE_URL` is missing or the database is unreachable, and warns if any pipeline API key is missing.

The source of truth for environment variable names is `backend/src/config.js` (institution-specific config) and the provider files under `backend/src/auth/providers/`.

## Required variables

These must be set for the portal to boot. Missing values cause either preflight failure (`exit 1`) or warnings that degrade functionality.

| Name | Required | Default | Purpose |
|------|----------|---------|---------|
| `JWT_SECRET` | Yes | *(none)* | Signing key for authentication cookies. Set to a 64-character random hex string. |
| `DB_PASSWORD` | Yes | *(none)* | PostgreSQL password for the `aif` database user. Used by both `app` and `db` containers. |
| `DATABASE_URL` | Yes | `postgresql://aif:${DB_PASSWORD}@db:5432/aif` | Postgres connection string. Pre-set by `docker-compose.yml`; override only for external databases. |
| `AUTH_PROVIDER` | Yes | `cas` (or `bypass` if `AUTH_BYPASS=true`) | SSO strategy. One of `cas`, `header`, `oidc`, `saml`, `bypass`. |

## Pipeline API keys

At least one pipeline key is required to run agent analysis; missing keys do not block server startup but will cause the affected passes to fail.

| Name | Required | Default | Purpose |
|------|----------|---------|---------|
| `OPENAI_API_KEY` | Yes for pipeline | *(none)* | Codex CLI (GPT-5.4, pass 1). |
| `OPENROUTER_API_KEY` | Yes for pipeline | *(none)* | Direct OpenRouter API calls for MiniMax, MiMo, Kimi, GLM (passes 2-5). |
| `ANTHROPIC_API_KEY` | Yes for pipeline | *(none)* | Claude Code CLI synthesis pass. |
| `SNYK_TOKEN` | No | *(none)* | Enables Snyk agent-scan for MCP/SKILL.md threat detection. Pipeline skips this check silently when unset. |

## Authentication

| Name | Required | Default | Purpose |
|------|----------|---------|---------|
| `AUTH_PROVIDER` | Yes | `cas` | Selects the SSO strategy. See [authentication-setup.md](authentication-setup.md) for the full matrix. |
| `AUTH_BYPASS` | No | `false` | Legacy alias. When `true`, forces `AUTH_PROVIDER=bypass`. |
| `JWT_SECRET` | Yes | *(none)* | HMAC key for JWT cookies. |
| `ADMIN_NETIDS` | No | *(empty)* | Comma-separated list of usernames auto-assigned the `admin` role on first login. |

Provider-specific variables (`CAS_*`, `OIDC_*`, `SAML_*`, `AUTH_HEADER_*`) are documented in [authentication-setup.md](authentication-setup.md).

### User roles and admin bootstrap

The first user to authenticate receives the `admin` role automatically, regardless of `ADMIN_NETIDS`. Every subsequent user receives the `builder` role unless their username is listed in `ADMIN_NETIDS`. Roles are modifiable at any time by an administrator through the Admin Dashboard. See [../admin-guide/user-management.md](../admin-guide/user-management.md).

## URLs and paths

| Name | Required | Default | Purpose |
|------|----------|---------|---------|
| `BASE_PATH` | No | `/aif` | URL prefix for the API and frontend. All routes are mounted under this path. |
| `FRONTEND_URL` | No | *(empty)* | Absolute URL used for post-login redirects. Falls back to `BASE_PATH` when unset. Set this when the portal is reached through a reverse proxy or custom domain. |
| `OUTPUT_DIR` | No | `/data/output` | Container path where agent reports and generated documents are written. Mapped to the `aif_output` volume. |
| `CODEBASES_DIR` | No | `/data/codebases` | Container path where uploaded archives and cloned git repositories are staged. Mapped to the `aif_codebases` volume. |
| `HECVAT_TEMPLATE_PATH` | No | `/app/hecvat415.xlsx` | Path to the HECVAT 4.15 XLSX template inside the container. |

## Institution identity

These values surface in the frontend through `GET /aif/api/config` and in outgoing notification emails.

| Name | Required | Default | Purpose |
|------|----------|---------|---------|
| `INSTITUTION_NAME` | No | *(empty)* | Display name rendered in the portal header and emails (for example `University of Montana`). |
| `INSTITUTION_DOMAIN` | No | *(empty)* | Email domain used to derive default user email addresses (`<netid>@<INSTITUTION_DOMAIN>`) when the SSO provider does not supply one. |

## Email notifications

Email is optional. When `SMTP_HOST` is empty, AIF writes in-app notifications only. When configured, the server verifies SMTP reachability on startup and logs a warning if the relay is unreachable; it does not fail preflight.

| Name | Required | Default | Purpose |
|------|----------|---------|---------|
| `SMTP_HOST` | No | *(empty)* | SMTP relay hostname. Leave empty to disable email. |
| `SMTP_PORT` | No | `25` | SMTP port. |
| `SMTP_FROM` | No | *(empty)* | From address on outgoing notifications (for example `noreply-aif@example.edu`). |

Per-user delivery preferences (`notify_email`, `notify_in_app`, `email`) are managed in the portal via the notification bell.

## Runtime (set by the image, not by the operator)

The following variables are hard-coded in `Dockerfile` and should not be overridden for typical deployments.

| Name | Default | Purpose |
|------|---------|---------|
| `NODE_ENV` | `production` | Enables production-mode guards, including the production block on `AUTH_PROVIDER=bypass`. |
| `PORT` | `3000` | Container-internal HTTP port. Host mapping (default `3300`) is set in `docker-compose.yml`. |

## Example `.env` for production CAS deployment

```
# Server
JWT_SECRET=f2a1c5e8b4d9...(64 hex chars)
DB_PASSWORD=<generated-strong-password>

# Pipeline
OPENAI_API_KEY=sk-...
OPENROUTER_API_KEY=sk-or-...
ANTHROPIC_API_KEY=sk-ant-...
SNYK_TOKEN=

# Auth
AUTH_PROVIDER=cas
ADMIN_NETIDS=jdoe,asmith
CAS_BASE_URL=https://login.example.edu/cas
CAS_SERVICE_URL=https://aif.example.edu/aif/api/auth/callback

# URLs
FRONTEND_URL=https://aif.example.edu/aif/

# Institution
INSTITUTION_NAME=Example University
INSTITUTION_DOMAIN=example.edu

# Email
SMTP_HOST=smtp.example.edu
SMTP_PORT=25
SMTP_FROM=noreply-aif@example.edu
```

## Verifying configuration

After any change to `backend/.env`, restart the app container:

```
docker compose up -d
```

Check the preflight log line:

```
docker logs aif-app 2>&1 | grep Preflight
```

A healthy boot produces:

```
{"level":"info","msg":"Preflight OK","auth":"cas","email":"smtp.example.edu:25","pipelineKeys":"3/3"}
```

Preflight failures exit the container with status `1` and log the specific issue. Warnings (missing pipeline keys, unreachable SMTP, missing HECVAT template) do not block startup but indicate degraded functionality.

## See also

- [installation.md](installation.md) — first-boot walkthrough
- [authentication-setup.md](authentication-setup.md) — per-provider SSO variables
- [../admin-guide/](../admin-guide/) — runtime administration
- [../architecture/auth-providers.md](../architecture/auth-providers.md) — auth provider architecture
