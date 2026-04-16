# AIF Documentation

Reference documentation for the AI Production Readiness Framework (AIF). This directory contains the complete technical and governance documentation for the portal, its agent pipeline, its API, and adoption at other institutions.

## Start Here

New to AIF? Read these in order:

1. [What AIF does](user-guide/overview.md) — The submission lifecycle, three roles, what the system produces.
2. [Installation](getting-started/installation.md) — Docker-based setup, first boot.
3. [Configuration](getting-started/configuration.md) — Every environment variable.
4. [First submission](getting-started/first-submission.md) — End-to-end walkthrough.

## Sections

### [Getting Started](getting-started/)

First-time setup. Intended for operators standing up a new AIF instance.

- [Installation](getting-started/installation.md)
- [Configuration](getting-started/configuration.md)
- [Authentication setup](getting-started/authentication-setup.md) — CAS, header, OIDC, SAML, bypass
- [First submission](getting-started/first-submission.md)

### [User Guide](user-guide/)

For builders submitting AI-built tools and reviewers approving them.

- [Overview](user-guide/overview.md)
- [Intake form](user-guide/intake-form.md) — The 21-question form
- [Scoring model](user-guide/scoring-model.md) — 7 dimensions
- [Tracks](user-guide/tracks.md) — What happens in Tracks 1-4
- [Pipeline](user-guide/pipeline.md) — Watching the agents run
- [Reviewing findings](user-guide/reviewing-findings.md) — Triage
- [Review decisions](user-guide/review-decisions.md) — For reviewers
- [Notifications](user-guide/notifications.md)
- [FAQ](user-guide/faq.md)

### [Admin Guide](admin-guide/)

For system administrators operating an AIF deployment.

- [Overview](admin-guide/overview.md)
- [Deployment](admin-guide/deployment.md) — Production, reverse proxy, TLS, scaling
- [User management](admin-guide/user-management.md) — RBAC, promoting users
- [System dashboard](admin-guide/system-dashboard.md)
- [Pipeline analytics](admin-guide/pipeline-analytics.md) — Model metrics, cost tracking
- [Audit log](admin-guide/audit-log.md)
- [Data retention](admin-guide/data-retention.md)
- [Monitoring](admin-guide/monitoring.md)
- [Troubleshooting](admin-guide/troubleshooting.md)
- [Backup & restore](admin-guide/backup-restore.md)

### [Architecture](architecture/)

System design, internals, and technical rationale.

- [Overview](architecture/overview.md)
- [Backend](architecture/backend.md) — Express, middleware, routes
- [Frontend](architecture/frontend.md) — React, routing, state
- [Database](architecture/database.md) — Schema, migrations
- [Pipeline internals](architecture/pipeline-internals.md) — 4 agents, 5 models, synthesis
- [Deterministic tools](architecture/deterministic-tools.md) — Semgrep, ESLint, Snyk
- [Auth providers](architecture/auth-providers.md) — Pluggable SSO
- [Security](architecture/security.md) — Threat model and controls

### [API Reference](api/)

REST API reference for integrators and scripts.

- [Overview](api/overview.md) — Auth, CSRF, rate limits, conventions
- [Auth endpoints](api/auth.md)
- [Intake endpoints](api/intake.md)
- [Registry endpoints](api/registry.md)
- [Pipeline endpoints](api/pipeline.md)
- [Reports endpoints](api/reports.md)
- [Review endpoints](api/review.md)
- [Admin endpoints](api/admin.md)
- [Analytics endpoints](api/analytics.md)
- [Notifications endpoints](api/notifications.md)

### [Framework](framework/)

Governance framework specification: scoring, track routing, escalation.

- [Scoring model](framework/scoring-model.md) — Full 7-dimension spec
- [Track routing](framework/track-routing.md) — Threshold math
- [Escalation conditions](framework/escalation-conditions.md) — 7 triggers
- [HECVAT integration](framework/hecvat.md) — EDUCAUSE 4.15

### [Development](development/)

For contributors and forks.

- [Setup](development/setup.md) — Local dev environment
- [Testing](development/testing.md) — Test strategy, running tests
- [Adding an auth provider](development/adding-auth-provider.md) — OIDC/SAML implementation
- [Extending agents](development/extending-agents.md) — Adding a new agent type
- [Contributing](development/contributing.md)

### [Institutional Adoption](institutional-adoption/)

For institutions evaluating or adopting AIF.

- [Porting](institutional-adoption/porting.md) — Step-by-step adoption
- [Customization](institutional-adoption/customization.md) — What can be changed
- [Compliance mapping](institutional-adoption/compliance-mapping.md) — NIST AI RMF, NIST CSF, WCAG, HECVAT, OWASP

## Conventions

- **File references** use the format `path/to/file.ext:line_number` for specificity.
- **Environment variables** are in `UPPERCASE`.
- **Roles** are lowercase: `builder`, `reviewer`, `admin`.
- **Status values** are lowercase with underscores: `under_review`, `changes_requested`.
- **Track numbers** range from 1 (lowest risk) to 4 (highest risk).
- **Terms**:
  - *Tool* — An AI-built application being submitted for review.
  - *Run* — A single execution of the agent pipeline against a tool's codebase.
  - *Agent* — One of the four pipeline stages (Code & Security, Accessibility, QA, Documentation).
  - *Pass* — One of the five models within a multi-model agent.
  - *Finding* — An issue identified by the pipeline, with severity and evidence.
  - *Confidence tier* — `tool-verified` (deterministic), `confirmed` (3+ models agree), `potential` (1-2 models).

## Contact

This documentation is maintained with the codebase. Report errors or gaps via GitHub issues at the [project repository](https://github.com/umzcio/AIF).
