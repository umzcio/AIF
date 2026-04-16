# Admin Overview

System administrators are responsible for deploying, operating, and maintaining the AIF portal. The admin role has full visibility into all tools, pipeline runs, users, and audit activity, and controls the only operations that affect the system as a whole.

## Responsibilities

Administrators handle three distinct concerns:

| Concern | Scope |
|---------|-------|
| Platform operations | Deploy containers, apply migrations, rotate secrets, manage backups, monitor health |
| User lifecycle | Promote reviewers, deactivate departing users, audit role changes |
| Policy enforcement | Review audit log, configure retention, investigate pipeline failures |

The admin role is not a replacement for the reviewer role. Administrators may review tools, but should do so only when standing in for an absent reviewer.

## Admin Role in the Portal

The admin role is granted in two ways:

1. **First user** — the first user to log in receives the admin role automatically. This bootstraps new deployments.
2. **`ADMIN_NETIDS`** — any netid listed in the `ADMIN_NETIDS` environment variable receives the admin role on first login.

See [User Management](user-management.md) for the full promotion path.

All admin actions (role changes, user deactivation, manual retention runs) are written to the audit log. See [Audit Log](audit-log.md).

## What Admins Can Do

### From the Admin Dashboard

The Admin Dashboard is available at `/aif/#/admin` and has four tabs:

| Tab | Purpose | Detailed doc |
|-----|---------|--------------|
| Overview | Tool counts, pending reviews, pipeline activity | [System Dashboard](system-dashboard.md) |
| Pipeline Analytics | Per-model metrics, cost tracking, trends | [Pipeline Analytics](pipeline-analytics.md) |
| Users | List users, change roles, deactivate accounts | [User Management](user-management.md) |
| Audit Log | Filter and page through audit entries | [Audit Log](audit-log.md) |

### From the Shell

Some operations are not exposed in the UI and must be run via shell access to the host:

| Operation | Command | Doc |
|-----------|---------|-----|
| View application logs | `docker logs aif-app` | [Monitoring](monitoring.md) |
| Database backup | `docker exec aif-db pg_dump ...` | [Backup and Restore](backup-restore.md) |
| Apply migrations | Automatic on container start | [Deployment](deployment.md) |
| Rotate JWT secret | Update `.env`, restart app | [Deployment](deployment.md) |
| Inspect pipeline output | `docker exec aif-app ls /data/output` | [Troubleshooting](troubleshooting.md) |

### Via HTTP API

Admin-only endpoints are grouped under `/aif/api/admin` and `/aif/api/analytics`. All require a valid JWT cookie and the `admin` role. State-changing endpoints require a CSRF token in the `x-csrf-token` header.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/dashboard` | GET | Aggregate system stats |
| `/api/admin/users` | GET | List all users |
| `/api/admin/users/:id/role` | PATCH | Change user role |
| `/api/admin/users/:id/active` | PATCH | Toggle user active flag |
| `/api/admin/audit` | GET | Paginated audit log with filters |
| `/api/admin/retention` | POST | Manually trigger retention job |
| `/api/analytics/overview` | GET | Pipeline performance summary |
| `/api/analytics/model/:name` | GET | Per-model pass history |
| `/api/analytics/run/:id` | GET | Per-run timing breakdown |
| `/api/analytics/trends` | GET | Time-series pipeline data |

## What Admins Cannot Do

- Admins cannot deactivate themselves. The portal rejects `PATCH /users/:id/active` when the target is the current user.
- Admins cannot permanently delete audit log entries via the UI. The retention job is configured to report on old audit entries but never delete them. See [Data Retention](data-retention.md).
- Admins cannot modify pipeline results after a run completes. Findings are immutable once a run is marked `completed`.

## Operational Surface

The AIF portal consists of two containers and three named volumes:

| Component | Type | Purpose |
|-----------|------|---------|
| `aif-app` | Container | Node.js + Express + bundled frontend |
| `aif-db` | Container | PostgreSQL 16 |
| `aif_pgdata` | Volume | Database files |
| `aif_output` | Volume | Pipeline run output (JSON, markdown, docx, xlsx) |
| `aif_codebases` | Volume | Uploaded and cloned codebases |

See [Deployment](deployment.md) for the full container and volume layout.

## Assumptions

This documentation assumes the following:

- The administrator has shell access to the host running the AIF containers, with permission to run `docker` and `docker compose`.
- The host has a reverse proxy (nginx, Caddy, Traefik, or similar) terminating TLS and forwarding to the app container.
- The institution has a CAS, OIDC, SAML, or reverse-proxy-based SSO that can be configured against AIF. See [Deployment](deployment.md) for the supported auth providers.
- An SMTP relay is available if email notifications are desired. Email is optional.
- The administrator has a basic understanding of PostgreSQL and JSON-formatted logs.

## Escalation

For incidents that exceed the operational surface documented here (for example, data corruption, security breach, or suspected compromise of the API keys used by the pipeline), the administrator should:

1. Stop the `aif-app` container to prevent further pipeline runs.
2. Snapshot the three volumes (see [Backup and Restore](backup-restore.md)).
3. Rotate the affected API keys in `backend/.env`.
4. Audit the `audit_log` table for the relevant time window.
5. Contact the AIF framework maintainers via the GitHub repository if a framework-level bug is suspected.
