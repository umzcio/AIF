# Deployment

AIF is distributed as a two-container Docker Compose stack: an application container serving the backend API and bundled frontend, and a PostgreSQL container for persistent storage. This document covers production deployment, reverse proxy configuration, TLS termination, and scaling considerations.

## Prerequisites

| Requirement | Minimum |
|-------------|---------|
| Docker Engine | 24.0+ |
| Docker Compose | v2.20+ |
| Host memory | 10 GB (8 GB app + 1 GB db + overhead) |
| Host CPU | 4 cores |
| Host disk | 50 GB free for volumes, plus codebases |
| Outbound HTTPS | To `api.openai.com`, `openrouter.ai`, `api.anthropic.com` |
| Reverse proxy | nginx, Caddy, Traefik, or equivalent in front of port 3300 |

A domain name with a valid TLS certificate is required. The portal must be served at a path prefix, defaulting to `/aif`.

## Container Layout

```
aif-app (Node.js 22, port 3000 → host 3300)
  ├── runs as non-root user `aif`
  ├── reads/writes: aif_output, aif_codebases
  ├── depends on: aif-db
  └── restart: unless-stopped

aif-db (postgres:16-alpine, port 5432)
  ├── stores in: aif_pgdata
  ├── healthcheck: pg_isready -U aif
  └── restart: unless-stopped
```

Both containers join the `aif-network` bridge network. The app reaches the database by the service name `db:5432`.

## Environment Variables

All configuration lives in `backend/.env`. Copy `backend/.env.example` and fill in values.

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | `postgresql://aif:${DB_PASSWORD}@db:5432/aif` |
| `DB_PASSWORD` | Database password. Change from the default. |
| `JWT_SECRET` | 32+ byte random hex string. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `AUTH_PROVIDER` | `cas`, `oidc`, `saml`, `header`, or `bypass` |
| `FRONTEND_URL` | Public URL, e.g. `https://example.edu/aif/` |
| `INSTITUTION_NAME` | Displayed in UI and emails |
| `INSTITUTION_DOMAIN` | Used for email address defaults |

### Pipeline API Keys (required for agent runs)

| Variable | Used by |
|----------|---------|
| `OPENAI_API_KEY` | Codex CLI (pass 1) |
| `OPENROUTER_API_KEY` | MiniMax, MiMo, Kimi, GLM (passes 2-5) |
| `ANTHROPIC_API_KEY` | Claude Code CLI (synthesis) |
| `SNYK_TOKEN` | Optional — Snyk agent-scan |

If pipeline keys are absent, the server will still start but will log preflight warnings and pipeline runs will fail at the affected pass.

### Auth Provider Specific

| Provider | Required Variables |
|----------|-------------------|
| `cas` | `CAS_BASE_URL`, `CAS_SERVICE_URL` |
| `oidc` | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI` |
| `saml` | `SAML_ENTRY_POINT`, `SAML_ISSUER`, `SAML_CERT`, `SAML_CALLBACK_URL` |
| `header` | `AUTH_HEADER_USER`, `AUTH_HEADER_DISPLAY_NAME` |
| `bypass` | None. Auto-creates admin user. **Do not use in production.** |

### Optional

| Variable | Default | Purpose |
|----------|---------|---------|
| `ADMIN_NETIDS` | (empty) | Comma-separated netids auto-promoted to admin |
| `SMTP_HOST` | (empty) | Enables email notifications |
| `SMTP_PORT` | 25 | |
| `SMTP_FROM` | (empty) | From address for email |
| `GIT_ALLOWED_HOSTS` | (empty) | Comma-separated hostnames allowed as codebase URLs |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

## Initial Deployment

```bash
# 1. Clone repo
git clone https://github.com/your-org/aif.git
cd aif

# 2. Configure environment
cp backend/.env.example backend/.env
$EDITOR backend/.env

# 3. Build and start
docker compose up -d --build

# 4. Verify
curl -fsS http://localhost:3300/aif/api/health
# Expected: {"status":"ok","database":"connected","uptime":<n>}

# 5. Watch startup logs
docker logs -f aif-app
```

On first startup, the app:

1. Runs `startup.sh` as root to fix volume ownership.
2. Writes `~aif/.codex/auth.json` with the OpenAI API key.
3. Applies pending migrations via `node src/db/migrate.js`.
4. Runs preflight checks (env vars, DB connectivity, HECVAT template, SMTP).
5. Recovers any runs left in `running` state from a prior restart.
6. Listens on port 3000 inside the container.

If preflight fails (missing `JWT_SECRET`, unreachable DB), the container exits with code 1 and restarts per the `unless-stopped` policy.

## Reverse Proxy

AIF serves at the `/aif` path prefix by default. The reverse proxy must forward this path to port 3300 on the host, preserving the original host header.

### nginx Example

```nginx
upstream aif_backend {
  server 127.0.0.1:3300;
}

server {
  listen 443 ssl http2;
  server_name example.edu;

  ssl_certificate     /etc/ssl/certs/example.edu.crt;
  ssl_certificate_key /etc/ssl/private/example.edu.key;

  # Redirect root to /aif/
  location = / {
    return 302 /aif/;
  }

  location /aif {
    proxy_pass http://aif_backend;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # SSE streaming for pipeline progress
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
  }
}
```

SSE endpoints (`/aif/api/pipeline/:id/stream`) require `proxy_buffering off` and a long read timeout. Without this, pipeline progress events will be delayed or dropped.

### Caddy Example

```
example.edu {
  reverse_proxy /aif* 127.0.0.1:3300 {
    flush_interval -1
    transport http {
      read_timeout 1h
    }
  }
}
```

## TLS

The app container does not terminate TLS. TLS must be terminated at the reverse proxy. Internal communication between the proxy and the app container uses HTTP on a loopback port.

Cookies set by AIF use `secure: true`. The reverse proxy must set `X-Forwarded-Proto: https` for the CSRF cookie to be accepted by the browser on the initial request.

## Migrations

Migrations are in `backend/migrations/NNN_name.sql` and run automatically on every container start via `node src/db/migrate.js`. The migration runner:

- Creates a `_migrations` tracking table on first run.
- Skips any migration whose filename is already recorded.
- Applies remaining migrations in lexicographic order inside a transaction.
- Exits non-zero if any migration fails; the container then restarts and retries.

To check applied migrations:

```bash
docker exec aif-db psql -U aif -d aif -c "SELECT name, applied_at FROM _migrations ORDER BY name;"
```

## Resource Limits

Defaults in `docker-compose.yml`:

| Container | Memory | CPU |
|-----------|--------|-----|
| `aif-app` | 8 GB | 4 |
| `aif-db` | 1 GB | unlimited |

The app limit is sized for concurrent pipeline runs. Each active run can hold ~400 KB of bundled codebase plus agent output in memory. Reduce if only one run is expected at a time.

Log rotation is configured per-container:

| Container | Max size per file | Max files |
|-----------|-------------------|-----------|
| `aif-app` | 50 MB | 5 |
| `aif-db` | 20 MB | 3 |

## Scaling

AIF is designed as a single-instance deployment. Horizontal scaling is not supported because:

- The in-process job queue (`src/pipeline/queue.js`) holds state in memory.
- Pipeline SSE streams are bound to the node that received the request.
- File-based pipeline output lives on a host volume.

To increase throughput, increase the host's CPU and memory. A single instance has been tested running up to 4 concurrent pipeline runs on 16 cores.

For multi-institution deployment, run one stack per institution.

## Updating

```bash
cd /path/to/aif
git pull
docker compose up -d --build
docker logs -f aif-app   # Watch preflight + migrations
```

The app performs a graceful shutdown on `SIGTERM`: it stops accepting new connections, drains in-flight requests, and closes the DB pool. A 30-second hard timeout ensures the container exits even if a request hangs.

Active pipeline runs are not drained on shutdown. They are marked as `failed` on the next startup via `recoverOnStartup()`. To avoid losing work, cancel or wait for active runs before restarting.

## Related

- [Monitoring](monitoring.md) — health checks, log aggregation
- [Backup and Restore](backup-restore.md) — volume and database backup
- [Troubleshooting](troubleshooting.md) — common deployment failures
- [User Management](user-management.md) — bootstrapping the first admin
