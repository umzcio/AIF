# Local Development Setup

Set up AIF for local development: run the backend and frontend separately with hot reload, configure environment variables, and apply database migrations. Production deployment uses Docker Compose and is covered in [getting-started/installation.md](../getting-started/installation.md); this document covers the inner-loop developer workflow.

## Prerequisites

- **Node.js 20+** — ESM-native, uses `node --watch` and the built-in test runner
- **PostgreSQL 16** — local instance or Dockerised (`docker run -p 5432:5432 -e POSTGRES_PASSWORD=aif postgres:16-alpine`)
- **API keys** for the agent pipeline (optional if you only work on the portal UI)
  - `OPENAI_API_KEY` — Codex CLI (pass 1)
  - `OPENROUTER_API_KEY` — MiniMax, MiMo, Kimi, GLM (passes 2-5)
  - `ANTHROPIC_API_KEY` — Claude Code CLI (synthesis + docs)
- **CLI tools** (only required if you plan to run the pipeline locally)
  - [Codex](https://github.com/openai/codex) — `npm install -g @openai/codex`
  - [Claude Code](https://github.com/anthropics/claude-code) — `npm install -g @anthropic-ai/claude-code`
  - [Pandoc](https://pandoc.org/) — for `.md` to `.docx` conversion

## Repository Layout

```
AIF/
├── backend/          # Express API + agent pipeline (Node.js, ESM)
├── frontend/         # Vite + React portal
├── docs/             # Reference documentation (this tree)
├── docker-compose.yml
└── Dockerfile
```

Treat the two packages as independent. Each has its own `package.json`, `node_modules`, and runtime. Full architecture detail lives in [architecture/overview.md](../architecture/overview.md).

## Backend Setup

### Install Dependencies

```bash
cd backend
npm install
```

### Configure Environment

Copy the example file and fill in the required values.

```bash
cp .env.example .env
```

Minimum viable `.env` for local development:

```bash
# Database
DATABASE_URL=postgresql://aif:aif@localhost:5432/aif

# Auth — use bypass mode locally; see docs/development/adding-auth-provider.md for real SSO
AUTH_PROVIDER=bypass
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ADMIN_NETIDS=dev

# Institution identity
INSTITUTION_NAME=Dev Institution
INSTITUTION_DOMAIN=example.edu
FRONTEND_URL=http://localhost:5173/

# Pipeline (optional for portal-only work)
OPENAI_API_KEY=sk-...
OPENROUTER_API_KEY=sk-or-...
ANTHROPIC_API_KEY=sk-ant-...

# Node
NODE_ENV=development
```

`AUTH_PROVIDER=bypass` auto-authenticates every request as a fixed `dev` user. It is gated to `NODE_ENV !== "production"` at the provider level and must never be enabled in production.

### Create the Database

```bash
# Using the Postgres container started above:
createdb -h localhost -U postgres aif
psql -h localhost -U postgres -c "CREATE USER aif WITH PASSWORD 'aif';"
psql -h localhost -U postgres -c "GRANT ALL ON DATABASE aif TO aif;"

# Apply migrations
npm run migrate
```

`npm run migrate` runs every file in `backend/migrations/` in filename order and records applied migrations in the `_migrations` table. Re-running is idempotent.

### Run the Dev Server

```bash
npm run dev
```

This invokes `node --watch src/server.js`. The watcher restarts the process on any file change under `backend/src/`. The API listens on port `3300` by default.

### Verify

```bash
curl http://localhost:3300/api/config
# Expect: { "institution": "Dev Institution", "authProvider": "bypass", ... }
```

## Frontend Setup

### Install Dependencies

```bash
cd frontend
npm install
```

### Configure

The frontend has no `.env` of its own. It talks to the backend at the origin declared in `vite.config.js` — by default `http://localhost:3300`. Change the proxy target if your backend runs elsewhere.

### Run the Dev Server

```bash
npm run dev
```

Vite serves at `http://localhost:5173/` with HMR. API requests proxy through to the backend. Hash routing (`#/tool/:id`) means no server-side route configuration is needed.

### Production Build

```bash
npm run build
```

Output lands in `frontend/dist/`. Production deployment embeds this into the backend container — see the root `Dockerfile`.

## Running the Full Stack

Open two terminals:

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
```

Navigate to `http://localhost:5173/`. You will be auto-authenticated as `dev` with admin privileges (because `ADMIN_NETIDS=dev`).

## CLI Pipeline Usage

Run the agent pipeline against a local codebase without starting the portal:

```bash
cd backend
node src/index.js /path/to/codebase             # Default: TRACK_3
node src/index.js /path/to/codebase TRACK_1
node src/index.js /path/to/codebase TRACK_4
```

Output lands in `backend/output/<tool>_<timestamp>/`. The CLI invokes the same `runDirectApiPipeline` used by the portal queue. See [architecture/pipeline.md](../architecture/pipeline.md) for pass-level detail.

### Verify LLM Provider Keys

There is no standalone provider smoke-test script. After rotating keys or changing model IDs, verify connectivity by running the pipeline against a small fixture codebase (`node src/index.js /path/to/codebase`) — this exercises the actual `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, and `ANTHROPIC_API_KEY` code paths used in production.

## Database Migrations

Migration files live in `backend/migrations/` and follow the naming convention `NNN_description.sql`. Each migration runs once, in lexicographic order, wrapped in a transaction.

### Apply Migrations

```bash
npm run migrate
```

### Add a Migration

Create the next numbered SQL file:

```bash
touch migrations/015_your_change.sql
```

Write idempotent DDL — prefer `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. Test by running `npm run migrate` on a fresh database and a migrated one.

## Logging

The backend uses the structured logger in `src/logger.js`. Log lines are single-line JSON with `level`, `msg`, `timestamp`, and any `child()` context.

```js
import log from "./logger.js";
const agentLog = log.child({ component: "my-agent", runId });
agentLog.info("Pass started", { model: "kimi" });
```

In dev, pipe through `jq` for readability:

```bash
npm run dev 2>&1 | jq .
```

## Common Pitfalls

| Symptom | Cause | Fix |
|---------|-------|-----|
| `AUTH_BYPASS ignored in production` error on boot | `NODE_ENV=production` with `AUTH_PROVIDER=bypass` | Set `AUTH_PROVIDER=cas` or another real provider, or unset `NODE_ENV` for dev |
| `connect ECONNREFUSED 127.0.0.1:5432` | Postgres not running | Start the Postgres container or install locally |
| `JWT_SECRET is required` on boot | Missing `JWT_SECRET` in `.env` | Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| Pipeline fails with `codex: command not found` | Codex CLI not installed or not on `PATH` | `npm install -g @openai/codex`, confirm `which codex` |
| Frontend build fails with scoring import error | Frontend and backend weight matrices drifted | See [architecture/scoring.md](../architecture/scoring.md); frontend is preview-only and must match backend |
| `Rate limit exceeded` from OpenRouter | Passes 2-5 hit provider quota | Lower pipeline concurrency or upgrade the OpenRouter tier |

## Next Steps

- [testing.md](testing.md) — run and extend the test suite
- [extending-agents.md](extending-agents.md) — add a new agent to the pipeline
- [adding-auth-provider.md](adding-auth-provider.md) — implement OIDC or SAML for your institution
- [contributing.md](contributing.md) — commit style, PR process, and review expectations
