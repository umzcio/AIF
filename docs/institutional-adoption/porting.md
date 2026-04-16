# Porting AIF to Another Institution

## Summary

AIF was built at the University of Montana but carries no UM-specific code. All institution-dependent values — institution name, domain, SSO endpoints, administrator accounts, email sender, database credentials, pipeline API keys — are externalized to environment variables. The frontend loads institution identity at runtime from `/api/config`, so rebranding does not require a rebuild. Authentication is pluggable: a single `AUTH_PROVIDER` environment variable selects among CAS, OpenID Connect, SAML 2.0, reverse-proxy header authentication, and a development-mode bypass. Adopting AIF at another institution is a configuration task, not a fork: pull the repository, populate `backend/.env`, and run `docker compose up -d`. This document describes the full lift from decision to production and is intended for IT leadership and platform engineering teams evaluating adoption.

## Adoption at a glance

| Phase | Typical effort | Deliverable |
|-------|---------------|-------------|
| Evaluation | 1–2 weeks | Executive decision, resource assignment |
| Infrastructure provisioning | 1–3 days | Host, DNS, TLS certificate, database allocation |
| SSO integration | 1–5 days | CAS / OIDC / SAML / header configuration tested end-to-end |
| Pipeline key procurement | 1–5 days | OpenAI, OpenRouter, and Anthropic API keys |
| Deployment & verification | 1 day | Containers running, health check green, first test submission |
| Policy alignment | 2–6 weeks | Local governance review of intake questions, tracks, and escalation conditions |
| Pilot | 4–8 weeks | Controlled rollout to a subset of builders, reviewer training |

Total elapsed time from decision to general availability is typically six to twelve weeks, dominated by institutional policy review rather than technical work.

## Prerequisites

### Licensing

AIF is released under the MIT license. No commercial license, per-seat fee, or attribution obligation applies beyond preserving the copyright notice in source redistributions.

### Infrastructure

| Resource | Recommendation |
|----------|---------------|
| Host | Linux VM with Docker Engine 24+ and Compose V2 |
| CPU | 4 vCPU minimum; pipeline is CPU-bound during Codex and Claude passes |
| Memory | 16 GB minimum; default container limit is 8 GB application + 1 GB database |
| Disk | 50 GB; codebase uploads and pass outputs retained under `/data` |
| Network | Outbound HTTPS to `api.openai.com`, `openrouter.ai`, `api.anthropic.com`, and your SSO endpoint |
| TLS | Certificate for the public hostname (managed by a reverse proxy, not the AIF container) |
| Database | PostgreSQL 16 (bundled) or an external managed Postgres instance reachable by the application container |

### Accounts and credentials

- OpenAI API key with access to the Codex CLI model
- OpenRouter API key with sufficient credit for MiniMax, MiMo, Kimi, and GLM
- Anthropic API key with access to Claude Opus
- Optional: Snyk token for MCP/skill security scanning
- A 64-character random hex string for `JWT_SECRET`
- A strong password for the PostgreSQL user

## Step 1 — Obtain the source

```
git clone https://github.com/zrossmiller/AIF.git
cd AIF
cp backend/.env.example backend/.env
```

Pin to a specific release tag if your change-control process requires a stable reference.

## Step 2 — Set institution identity

Two variables in `backend/.env` drive all user-visible branding strings, email footers, and the display name served to the frontend via `/api/config`.

| Variable | Example | Where it appears |
|----------|---------|------------------|
| `INSTITUTION_NAME` | `Example University` | TopBar, email footer, generated compliance documents |
| `INSTITUTION_DOMAIN` | `example.edu` | Notification sender defaults, display metadata |

No code edit or frontend rebuild is required. The frontend reads these values from `/api/config` on every page load. See [customization.md](customization.md) for the full list of adjustable values.

## Step 3 — Configure authentication

AIF ships five auth strategies. Select one by setting `AUTH_PROVIDER`.

| Provider | `AUTH_PROVIDER` | Implementation status | Typical institution |
|----------|-----------------|----------------------|---------------------|
| CAS | `cas` | Production | Universities with Apereo CAS |
| Reverse-proxy header | `header` | Production | Shibboleth / `mod_shib` / Apache / Nginx front-ends |
| OpenID Connect | `oidc` | Stub — implementation required | Entra ID, Okta, Keycloak, Auth0 |
| SAML 2.0 | `saml` | Stub — implementation required | ADFS, Shibboleth IdP, OneLogin |
| Development bypass | `bypass` | Production-blocked | Local development only |

Each provider is a single file under `backend/src/auth/providers/` implementing three functions: `getLoginUrl()`, `authenticate(req)`, and `getLogoutUrl()`. The OIDC and SAML stubs document the required environment variables and the recommended npm packages (`openid-client`, `@node-saml/node-saml`). See [customization.md](customization.md#authentication-providers) for the provider interface contract.

### CAS

```
AUTH_PROVIDER=cas
CAS_BASE_URL=https://login.example.edu/cas
CAS_SERVICE_URL=https://aif.example.edu/aif/api/auth/callback
```

The provider supports both CAS 1.0 and CAS 2.0 response formats and accepts `cas:user`, `cas:commonName`, and `cas:displayName` attributes. Optional: `CAS_LOGOUT_URL` to override the default single-logout endpoint.

### Reverse-proxy header

For Shibboleth, `mod_shib`, or any auth-in-front-of-app configuration where the proxy injects identity headers on every request.

```
AUTH_PROVIDER=header
AUTH_HEADER_USER=REMOTE_USER
AUTH_HEADER_DISPLAY_NAME=displayName
```

No redirect flow runs inside AIF; the reverse proxy is responsible for establishing the session.

### OIDC and SAML

Both providers are present as stubs that throw a descriptive error until implemented. The stub headers document every environment variable the full implementation will consume, so institutions can pre-populate their `.env` and commit the configuration before the provider code lands.

### Development bypass

`AUTH_PROVIDER=bypass` authenticates every request as user `dev` and is automatically refused in production. The auth middleware gates the bypass behind `NODE_ENV !== "production"` and logs an error if it is requested under `NODE_ENV=production`. Do not rely on this for any non-development environment.

## Step 4 — Assign administrators

List the usernames (netids, UPNs, sAMAccountNames — whatever your SSO returns as the principal identifier) in `ADMIN_NETIDS`. The first time any listed user authenticates, their account record is created with the `admin` role.

```
ADMIN_NETIDS=jsmith,adoe,platformops
```

All other users default to `builder` on first login. Role elevation (to `reviewer` or `admin`) thereafter is an administrator action performed in the portal's User Management tab. See [admin-guide/user-management.md](../admin-guide/user-management.md) for the operational procedure.

## Step 5 — Populate pipeline API keys

```
OPENAI_API_KEY=sk-...
OPENROUTER_API_KEY=sk-or-...
ANTHROPIC_API_KEY=sk-ant-...
SNYK_TOKEN=                # optional
```

These keys are not required for the portal to start, but any missing key disables the corresponding agent pass. A preflight log entry at startup records how many pipeline keys were detected so operators can confirm a complete configuration.

## Step 6 — Database and secrets

```
DATABASE_URL=postgresql://aif:CHANGE_ME@db:5432/aif
DB_PASSWORD=CHANGE_ME
JWT_SECRET=<64 hex chars, generated with crypto.randomBytes>
FRONTEND_URL=https://aif.example.edu/aif/
```

If your institution requires an external managed database, override `DATABASE_URL` with the full connection string and remove the `db` service from `docker-compose.yml` or leave it unreferenced. Migrations run automatically on container start; no manual schema step is required.

## Step 7 — Email (optional)

Email notifications are off unless SMTP is configured. Leaving `SMTP_HOST` blank disables email delivery without affecting in-app notifications.

```
SMTP_HOST=smtp.example.edu
SMTP_PORT=25
SMTP_FROM=noreply-aif@example.edu
```

The message footer uses `INSTITUTION_NAME`. The message template itself contains one hardcoded color (`#1A6B4B`) that is not yet externalized; see [customization.md](customization.md#known-hardcoded-values) for the path to the template.

## Step 8 — Deploy

```
docker compose up -d
```

Two containers start: the application and PostgreSQL. Both have health checks; the application waits for the database to be ready before accepting traffic. Migrations are idempotent and run on every start.

Place a reverse proxy (Nginx, Apache, Traefik, Caddy) in front of the container on port `3300/tcp` to terminate TLS and, if you are using header authentication, to inject identity headers. The application listens on the path prefix `/aif/` by default; override with `BASE_PATH` if a different path is required.

## Step 9 — Smoke test

1. Navigate to `https://aif.example.edu/aif/` and authenticate.
2. Confirm the top bar displays your institution name.
3. Submit a draft intake form. The scoring sidebar should populate as you answer.
4. Upload a small test codebase. The pipeline should report progress via SSE.
5. Open the administrative dashboard as an `ADMIN_NETIDS` user and confirm the analytics tab is accessible.

If any step fails, consult [admin-guide/deployment.md](../admin-guide/deployment.md) for operational troubleshooting.

## Step 10 — Policy alignment

Before general availability, the institution's governance body should review and ratify:

- The twenty-one intake questions and their response options
- The seven-dimension scoring model and the per-artifact-type weight profiles
- The four-track routing percentages (22 %, 42 %, 65 %)
- The seven escalation conditions that force Track 4
- The status state machine (draft → pending → in\_progress → under\_review → approved → active) and its role restrictions

All of these are configurable, but all of them currently require a code or database-migration change rather than an environment variable. See [customization.md](customization.md) for the map of what can be changed where. Most institutions adopt the defaults verbatim for the first production cycle and revise after observing live data.

## Ongoing maintenance

| Task | Frequency | Owner |
|------|-----------|-------|
| Pipeline API key rotation | Per institutional secret policy | Platform engineering |
| JWT secret rotation | Per institutional secret policy | Platform engineering |
| Review retention output (90-day pass results, 30-day notifications) | Continuous | Automatic |
| Audit log review | Monthly or per policy | Compliance officer |
| Framework version alignment | On release | Governance body |
| Pipeline cost tracking | Monthly | Administrator via `/analytics/*` |

## Supported upgrade paths

AIF uses numbered SQL migrations that run automatically. Upgrading is `git pull && docker compose up -d --build`. Downgrades are not supported; rollback requires restoring a database snapshot.

## Where to go next

- [customization.md](customization.md) — what can be changed without forking, and what cannot
- [compliance-mapping.md](compliance-mapping.md) — how AIF controls align with NIST AI RMF, NIST CSF 2.0, WCAG 2.2, HECVAT, OWASP Top 10
- [getting-started/configuration.md](../getting-started/configuration.md) — complete reference for every environment variable
- [admin-guide/overview.md](../admin-guide/overview.md) — administrator operational responsibilities
- [framework/](../framework/) — the governance policy that the portal enforces
