# Architecture Overview

## Summary

The AI Production Readiness Framework (AIF) portal is a three-tier web application
that ingests candidate AI-assisted tools, routes them into one of four governance
tracks, runs a multi-agent automated review pipeline, and surfaces structured
findings plus auto-generated documentation to reviewers and builders. The
deployment is a single Docker-composed unit: a Node.js backend, a static Vite
bundle served by the same backend process, a PostgreSQL database, and an nginx
reverse proxy terminating TLS. No external services are required beyond a CAS
(or equivalent) identity provider, an SMTP relay, and the upstream LLM APIs used
by the pipeline.

## High-level Diagram

```
                  ┌────────────────────────────────────────────────────────┐
                  │                     Browser (SPA)                      │
                  │  React 19 + Vite, hash-based routing, SSE for pipeline │
                  └──────────────┬─────────────────────────────────────────┘
                                 │ HTTPS  /aif/api/*, cookies (aif_token, aif_csrf)
                                 ▼
                  ┌────────────────────────────────────────────────────────┐
                  │                 nginx reverse proxy                    │
                  │             TLS terminator, static assets              │
                  └──────────────┬─────────────────────────────────────────┘
                                 │ HTTP, trusted network
                                 ▼
   ┌─────────────────────────────────────────────────────────────────────────────┐
   │                     Node.js backend (Express, ESM)                          │
   │                                                                             │
   │  ┌─────────────┐   ┌──────────────┐   ┌─────────────────────────────────┐   │
   │  │ auth / SSO  │   │ REST routes  │   │ pipeline orchestrator + queue   │   │
   │  │ providers   │   │ intake /     │   │ (in-process, serial execution)  │   │
   │  │ (cas/hdr/   │   │ registry /   │   │                                 │   │
   │  │  oidc/saml) │   │ review /     │   │ ┌───────────┐ ┌───────────────┐ │   │
   │  └─────────────┘   │ admin / SSE  │   │ │ Codex CLI │ │ OpenRouter API│ │   │
   │                    └──────────────┘   │ │ (pass 1)  │ │ (passes 2–5)  │ │   │
   │                                       │ └───────────┘ └───────────────┘ │   │
   │                                       │ ┌───────────┐ ┌───────────────┐ │   │
   │                                       │ │Claude CLI │ │ Semgrep / ESLt│ │   │
   │                                       │ │(synthesis)│ │ npm audit/Snyk│ │   │
   │                                       │ └───────────┘ └───────────────┘ │   │
   │                                       └─────────────────────────────────┘   │
   └───────────────────────────┬────────────────────────────────────────────────┘
                               │ pg (raw SQL, pool)                 subprocess
                               ▼                                          │
                  ┌────────────────────────┐    ┌─────────────────────────┼────────┐
                  │   PostgreSQL 16        │    │ Filesystem: /data/      ▼        │
                  │   users, tools,        │    │   codebases/<toolId>/            │
                  │   pipeline_runs,       │    │   output/<tool>_<ts>/            │
                  │   agent_results,       │    │     agent1_code_analysis/        │
                  │   pass_results,        │    │     agent2_accessibility/        │
                  │   pipeline_metrics,    │    │     agent3_qa/                   │
                  │   audit_log,           │    │     agent4_documentation/        │
                  │   notifications, ...   │    │                                  │
                  └────────────────────────┘    └──────────────────────────────────┘
```

## Components

| Component | Technology | Role |
|-----------|-----------|------|
| Frontend SPA | React 19, Vite | Intake form, registry, pipeline UI, admin dashboard |
| Backend HTTP | Express 4 (ESM), `jose` JWT | REST API, SSE streaming, CSRF, rate limiting |
| Auth provider | Pluggable: CAS live, header live, bypass dev, OIDC/SAML stubs | Identity resolution, session issuance |
| Database | PostgreSQL 16 via `pg` | Source of truth for tools, runs, users, audit log |
| Pipeline queue | In-process, single-slot | Serial execution of pipeline runs |
| LLM layer | Codex CLI, OpenRouter API, Claude Code CLI | Five-model convergence + Claude synthesis |
| Deterministic tools | Semgrep, ESLint jsx-a11y, ESLint QA, npm audit, pip-audit, Snyk | Layer 0 ground truth, parallel with model passes |
| Notifications | In-app (`notifications` table) + optional SMTP | Pipeline completion, review needed, status change |
| Reverse proxy | nginx | TLS, static assets, upstream to backend |

## Request Flow: Submit and Review

```
Builder              Frontend              Backend                 Pipeline           Reviewer
   │                    │                     │                        │                 │
   │  fill intake form  │                     │                        │                 │
   ├───────────────────▶│                     │                        │                 │
   │                    │ POST /intake/draft  │                        │                 │
   │                    ├────────────────────▶│                        │                 │
   │                    │                     │ compute track, persist │                 │
   │                    │                     │ (scoring.js)           │                 │
   │                    │                     │                        │                 │
   │                    │ POST /intake/submit │                        │                 │
   │                    ├────────────────────▶│                        │                 │
   │                    │                     │ status=pending         │                 │
   │                    │                     │                        │                 │
   │   upload codebase  │                     │                        │                 │
   │                    │ POST /pipeline/run  │                        │                 │
   │                    ├────────────────────▶│ enqueue(toolId)        │                 │
   │                    │                     ├───────────────────────▶│                 │
   │                    │ GET /pipeline/      │                        │                 │
   │                    │  :runId/stream (SSE)│                        │                 │
   │                    │◀────────────────────┼────────────────────────┤                 │
   │                    │  agent_start,       │                        │  bundle code    │
   │                    │  pass_start,        │                        │  pass 1 Codex   │
   │                    │  pass_complete,     │                        │  pass 2–5 API   │
   │                    │  agent_complete ... │                        │  synthesis      │
   │                    │                     │                        │                 │
   │                    │                     │ Track 1: status=active │                 │
   │                    │                     │ Track 2–4: under_review│                 │
   │                    │                     │                        │  notifyRole     │
   │                    │                     │                        ├────────────────▶│
   │                    │                     │                        │                 │
   │                    │                     │           POST /review/:id/decision      │
   │                    │                     │◀─────────────────────────────────────────┤
   │                    │                     │ approved → status=active                 │
```

Reads: every state-changing request carries the `aif_token` JWT cookie plus a
matching `x-csrf-token` header (double-submit cookie pattern,
`backend/src/server.js:57-89`). The cookie is `httpOnly`, `secure`, `sameSite=lax`
and is scoped to the `BASE_PATH` (`/aif` by default).

## Data Flow Boundaries

- **Untrusted input surface**: intake form JSON, uploaded archive, optional
  codebase Git URL, header values, CAS tickets. All validated by Zod
  (`backend/src/validation.js`), Archive extraction and Git clone are gated by
  `validateUrl()` / `validateExtractedPaths()` (see
  [security.md](./security.md)).
- **Trusted internal surface**: database, output directories, subprocess
  sandboxes. Subprocess environments are filtered to only pass the API keys each
  specific tool needs (`toolEnv()` / `filteredEnv()` in
  `backend/src/agents/shared/cli.js:21-50`).
- **External calls**: OpenRouter, OpenAI (via Codex CLI), Anthropic (via Claude
  Code CLI), SMTP relay, CAS validate endpoint. Outbound only; no inbound
  webhooks.

## Deployment Topology

Single Docker host with three containers:

| Container | Image | Notes |
|-----------|-------|-------|
| `aif` | Multi-stage Node.js + Python + pandoc | Non-root user, 8 GB / 4 CPU limit |
| `postgres` | `postgres:16` | Volume-backed, 1 GB limit |
| `proxy` | Shared nginx proxy on `/projects/proxy` | TLS termination |

The backend also mounts `/data/codebases` (uploaded source) and `/data/output`
(pipeline artifacts) as persistent volumes. There is no Redis, message broker,
or background worker — the queue lives in Node process memory
(`backend/src/pipeline/queue.js:57-60`) and is reconstructed on startup by
`recoverOnStartup()` which fails any `running` runs and redrives queued ones.

## Guarantees and Non-goals

- **Guarantee**: every state-changing action is audited to `audit_log` with
  actor netid, IP, and a JSONB detail payload (`backend/src/audit.js`,
  `backend/src/auth/middleware.js:79-86`).
- **Guarantee**: scoring on the server is authoritative —
  `backend/src/routes/intake.js:13-21` recomputes dimensions, escalations, and
  track from the raw 21 answers on every submit; the frontend computation in
  `frontend/src/constants.js` is a live preview only.
- **Non-goal (today)**: horizontal scale-out. The pipeline queue is single-slot
  and in-process. Multiple backend replicas would double-run queued jobs.
- **Non-goal (today)**: federation or multi-tenancy within one deployment.
  Institution identity comes from a single `INSTITUTION_NAME` +
  `INSTITUTION_DOMAIN` config pair (`backend/src/config.js:25-26`).

## Related Documents

- [backend.md](./backend.md) — Express routing and middleware stack
- [frontend.md](./frontend.md) — React layout, hash routing, SSE
- [database.md](./database.md) — Schema, indexes, transaction patterns
- [pipeline-internals.md](./pipeline-internals.md) — Agents, convergence,
  synthesis
- [deterministic-tools.md](./deterministic-tools.md) — Layer 0 scanners
- [auth-providers.md](./auth-providers.md) — SSO provider interface
- [security.md](./security.md) — Threat model and controls
