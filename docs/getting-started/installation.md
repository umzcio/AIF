# Installation

## Summary

AIF ships as two Docker containers: an application container (Node.js backend + pre-built React frontend + agent pipeline CLI tooling) and a PostgreSQL 16 container. Installation is a four-step process: install Docker, clone the repository, populate an environment file, and run `docker compose up -d`. Database migrations run automatically on container start. The portal is reachable at `http://<host>:3300/aif/` after the health check reports `ok`.

## Prerequisites

- [ ] **Docker Engine 24+** with the Compose V2 plugin (`docker compose`, not `docker-compose`)
- [ ] **Git** to clone the repository
- [ ] **Outbound HTTPS** from the host to `api.openai.com`, `openrouter.ai`, and `api.anthropic.com` for the agent pipeline
- [ ] **Pipeline API keys** (see [configuration.md](configuration.md)):
  - `OPENAI_API_KEY` — Codex CLI, pass 1
  - `OPENROUTER_API_KEY` — MiniMax, MiMo, Kimi, GLM, passes 2-5
  - `ANTHROPIC_API_KEY` — Claude Code CLI, synthesis
- [ ] A 64-character random string for `JWT_SECRET`
- [ ] A strong password for `DB_PASSWORD`
- [ ] A free port `3300/tcp` on the host (or an alternative — see [Changing the host port](#changing-the-host-port))

No host-side Node.js, Python, or PostgreSQL installation is required. All runtime dependencies — including Semgrep, Pandoc, the OpenAI Codex CLI, the Anthropic Claude Code CLI, the Google Gemini CLI, and the Qwen Code CLI — are provisioned inside the application image.

## Step 1 — Clone the repository

```
git clone https://github.com/zrossmiller/AIF.git
cd AIF
```

## Step 2 — Create the environment file

Copy the example file and edit it. The example file documents every variable; only a handful are required to boot.

```
cp backend/.env.example backend/.env
```

Set the following at minimum:

```
JWT_SECRET=<64-char hex string>
DB_PASSWORD=<strong password>
OPENAI_API_KEY=sk-...
OPENROUTER_API_KEY=sk-or-...
ANTHROPIC_API_KEY=sk-ant-...
AUTH_PROVIDER=bypass
```

Generate a JWT secret:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`AUTH_PROVIDER=bypass` is appropriate only for first boot and local development. See [authentication-setup.md](authentication-setup.md) before exposing the portal to real users.

For the full environment variable reference, see [configuration.md](configuration.md).

## Step 3 — Build and start

```
docker compose up -d
```

First boot builds the application image, which takes approximately 5–10 minutes (installing system packages, Semgrep, Pandoc, and four CLI tools). Subsequent boots are seconds.

Verify both containers are healthy:

```
docker compose ps
```

Expected output:

```
NAME      IMAGE               STATUS                   PORTS
aif-app   aif-app             Up 30 seconds (healthy)  0.0.0.0:3300->3000/tcp
aif-db    postgres:16-alpine  Up 31 seconds (healthy)
```

If `aif-app` shows `(health: starting)` for more than two minutes, see [Troubleshooting](#troubleshooting).

## Step 4 — Verify the install

The health endpoint reports database connectivity and process uptime.

```
curl http://localhost:3300/aif/api/health
```

Expected response:

```json
{"status":"ok","database":"connected","uptime":42}
```

Check the preflight log line emitted at startup:

```
docker logs aif-app 2>&1 | grep "Preflight OK"
```

Expected output:

```
{"level":"info","msg":"Preflight OK","auth":"bypass","email":"disabled","pipelineKeys":"3/3"}
```

`pipelineKeys` must read `3/3`. A lower count indicates one or more pipeline API keys are missing from `backend/.env`; the server will still start, but pipeline runs will fail on the affected passes.

## Step 5 — Open the portal

Navigate to:

```
http://localhost:3300/aif/
```

In `bypass` mode the application auto-authenticates you as an administrator (`netid=dev`). In any other mode you are redirected to your configured identity provider.

The first successful login creates the initial user record with the `admin` role. Subsequent users receive the `builder` role unless their username appears in `ADMIN_NETIDS`. See [configuration.md](configuration.md#user-roles-and-admin-bootstrap).

## Changing the host port

Port `3300` is the host-side default; the container always listens on `3000`. Edit `docker-compose.yml` to change the host mapping:

```yaml
services:
  app:
    ports: ["8080:3000"]    # change left side only
```

Then restart: `docker compose up -d`.

## Data persistence

Three named Docker volumes persist state across container restarts:

| Volume | Mount point | Contents |
|--------|-------------|----------|
| `aif_pgdata` | `/var/lib/postgresql/data` | PostgreSQL data directory |
| `aif_output` | `/data/output` | Agent reports, generated `.docx`, HECVAT `.xlsx` |
| `aif_codebases` | `/data/codebases` | Uploaded or cloned codebases under review |

To reset the installation and erase all state:

```
docker compose down -v
```

## Upgrading

```
git pull
docker compose up -d --build
```

Migrations are idempotent and run automatically on container start. No manual migration step is required.

## Troubleshooting

**`aif-app` stays in `health: starting`.** Check the logs for a preflight failure:

```
docker logs aif-app
```

A line beginning `{"level":"error","msg":"Preflight failed"}` indicates a missing required variable or unreachable database.

**`Database unreachable`.** The `db` container may not have finished initializing. Wait 10 seconds and check `docker compose ps`. If `aif-db` is unhealthy, inspect its logs: `docker logs aif-db`.

**`CSRF token mismatch` in browser console.** Clear cookies for the host and reload. CSRF tokens are scoped to the `/aif` path.

**Port `3300` already in use.** Change the host port mapping (see [Changing the host port](#changing-the-host-port)).

## Pipeline-only mode (no portal)

For one-off codebase reviews without starting the portal:

```
docker compose run --rm app node /app/backend/src/index.js /path/to/codebase TRACK_3
```

Track arguments are `TRACK_1`, `TRACK_2`, `TRACK_3` (default), or `TRACK_4`. Output lands in `/data/output/<run-id>/` inside the container (mapped to the `aif_output` volume).

## See also

- [configuration.md](configuration.md) — full environment variable reference
- [authentication-setup.md](authentication-setup.md) — per-provider SSO setup
- [first-submission.md](first-submission.md) — submit a tool and run the pipeline
- [../admin-guide/](../admin-guide/) — administering a running portal
- [../architecture/auth-providers.md](../architecture/auth-providers.md) — auth provider architecture
