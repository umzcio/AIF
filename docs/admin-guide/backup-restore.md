# Backup and Restore

AIF persistent state lives in three Docker volumes: `aif_pgdata` (database), `aif_output` (pipeline results), and `aif_codebases` (uploaded code). This document covers backup procedures for each, restore procedures, and disaster recovery.

## What to Back Up

| Volume | Contents | Priority | Recoverable otherwise? |
|--------|----------|----------|----------------------|
| `aif_pgdata` | PostgreSQL data directory. Users, tools, pipeline runs, audit log. | Critical | No |
| `aif_output` | Per-run agent output: findings JSON, reports, HECVAT, docs | High | Partially — can re-run pipeline, but loses historical reports |
| `aif_codebases` | Uploaded/cloned codebases used by past runs | Medium | Partially — if original source still exists elsewhere |
| `backend/.env` | All configuration including JWT_SECRET and API keys | Critical | Only if kept elsewhere |

`backend/.env` is the most operationally important artifact and is not in a Docker volume. Back it up separately to a secure secret store.

## Database Backup

### pg_dump (recommended)

```bash
# Logical backup — plain SQL
docker exec aif-db pg_dump -U aif -d aif --clean --if-exists \
  | gzip > aif-backup-$(date +%Y%m%d-%H%M%S).sql.gz

# Custom format (smaller, parallel restore)
docker exec aif-db pg_dump -U aif -d aif -F c -f /tmp/aif.dump
docker cp aif-db:/tmp/aif.dump ./aif-backup-$(date +%Y%m%d).dump
docker exec aif-db rm /tmp/aif.dump
```

Custom format is preferred for large databases. Plain SQL is better for quick inspection and portability.

### Scheduling

Cron example:

```cron
# /etc/cron.d/aif-backup
0 2 * * * root /usr/local/bin/aif-backup.sh
```

Script:

```bash
#!/bin/bash
set -euo pipefail
BACKUP_DIR=/backups/aif
mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d-%H%M%S)
docker exec aif-db pg_dump -U aif -d aif -F c -f /tmp/aif.dump
docker cp aif-db:/tmp/aif.dump "$BACKUP_DIR/aif-$TS.dump"
docker exec aif-db rm /tmp/aif.dump
# Retain 30 days
find "$BACKUP_DIR" -name 'aif-*.dump' -mtime +30 -delete
```

Verify your retention policy against institutional requirements. The audit log is part of this dump and may have its own retention rules.

### Backup Verification

```bash
# Inspect without restoring
docker exec aif-db pg_restore -l /tmp/aif.dump | head

# Test restore to a temporary database
docker exec aif-db createdb -U aif aif_test
docker exec aif-db pg_restore -U aif -d aif_test /tmp/aif.dump
docker exec aif-db psql -U aif -d aif_test -c "SELECT COUNT(*) FROM users;"
docker exec aif-db dropdb -U aif aif_test
```

## Volume Backup

The pipeline output and codebase volumes contain files, not database state. Use `tar` from an offline copy.

### Full volume backup (app stopped)

```bash
# Best practice: stop app so no writes are in flight
docker compose stop app

# Create tarballs
docker run --rm \
  -v aif_output:/data \
  -v "$(pwd)":/backup \
  alpine tar czf /backup/aif_output-$(date +%Y%m%d).tar.gz -C /data .

docker run --rm \
  -v aif_codebases:/data \
  -v "$(pwd)":/backup \
  alpine tar czf /backup/aif_codebases-$(date +%Y%m%d).tar.gz -C /data .

docker compose start app
```

### Live backup (app running)

For the output volume, live backup is acceptable — pipeline writes are per-run-directory and reasonably atomic. A backup taken during a run may have a partial output dir for that run, which is harmless.

```bash
docker run --rm \
  -v aif_output:/data \
  -v "$(pwd)":/backup \
  alpine tar czf /backup/aif_output-$(date +%Y%m%d).tar.gz -C /data .
```

### Volume size check

```bash
docker system df -v | grep aif_
```

Large `aif_output` volumes may warrant incremental backup (rsync) instead of full tarballs.

## Configuration Backup

Back up `backend/.env` to a secure location outside the server:

```bash
# To encrypted archive (using age)
age -r age1... backend/.env > .env.age

# Or to a password manager / secret store
```

Contents to preserve:

- `JWT_SECRET` — if lost, all users must log in again
- `DB_PASSWORD` — must match the `aif_pgdata` volume
- API keys — `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`
- Institution config — `AUTH_PROVIDER`, CAS/OIDC/SAML settings, `INSTITUTION_NAME`

Also back up any institution-specific customizations to `docker-compose.yml` and reverse proxy config.

## Restore Procedures

### Restore Database from pg_dump

From a full outage where the `aif_pgdata` volume is lost or corrupted:

```bash
# 1. Stop app (so it doesn't try to migrate during restore)
docker compose stop app

# 2. Recreate db with empty volume
docker compose down db
docker volume rm aif_pgdata  # Irreversible — ensure backup is verified
docker compose up -d db

# 3. Wait for db to be healthy
docker exec aif-db pg_isready -U aif
# Retry until: accepting connections

# 4. Restore from dump
docker cp ./aif-backup.dump aif-db:/tmp/aif.dump

# Custom format
docker exec aif-db pg_restore -U aif -d aif --clean --if-exists /tmp/aif.dump

# OR plain SQL
gunzip -c ./aif-backup.sql.gz | docker exec -i aif-db psql -U aif -d aif

# 5. Clean up
docker exec aif-db rm /tmp/aif.dump

# 6. Start app (will run migrations; idempotent)
docker compose up -d app
docker logs -f aif-app
```

Verify:

```bash
curl -fsS http://localhost:3300/aif/api/health
docker exec aif-db psql -U aif -d aif -c "SELECT COUNT(*) FROM users;"
docker exec aif-db psql -U aif -d aif -c "SELECT COUNT(*) FROM tools;"
docker exec aif-db psql -U aif -d aif -c "SELECT name FROM _migrations ORDER BY name;"
```

### Restore Volume from tarball

```bash
# 1. Stop app
docker compose stop app

# 2. Recreate volume empty
docker volume rm aif_output
docker volume create aif_output

# 3. Extract
docker run --rm \
  -v aif_output:/data \
  -v "$(pwd)":/backup \
  alpine tar xzf /backup/aif_output-20260101.tar.gz -C /data

# 4. Fix ownership (startup.sh will fix again, but preempt)
docker run --rm -v aif_output:/data alpine chown -R 1000:1000 /data

# 5. Start app
docker compose up -d app
```

Same procedure for `aif_codebases`.

### Partial Restore

Sometimes only the database is corrupted but output files are intact. Restore only `aif_pgdata`. The `output_dir` columns in `pipeline_runs` still point at valid paths on the preserved output volume.

## Disaster Recovery

### Scenario: Host lost

Starting from bare metal with backups available:

```bash
# 1. Provision new host, install Docker
# 2. Clone repo
git clone https://github.com/your-org/aif.git
cd aif

# 3. Restore .env from secret store
cp /secure/backup/.env backend/.env

# 4. Start db (empty)
docker compose up -d db

# 5. Restore database dump (as above)

# 6. Restore volume tarballs (as above)

# 7. Start app
docker compose up -d app

# 8. Update DNS and reverse proxy to point at new host
```

Expected downtime: dominated by backup retrieval + database restore. On a healthy db dump of tens of MB, restore is < 1 minute. Volume tarballs of GB may take longer.

### Scenario: Accidentally deleted all tools

```sql
-- On a broken state with recent backup
-- Check current state first
SELECT COUNT(*) FROM tools;

-- Option A: full restore from dump (loses data since dump)
-- Option B: restore specific rows
docker exec aif-db psql -U aif -d aif_test -c "COPY (SELECT * FROM tools) TO STDOUT" > tools.csv
docker exec -i aif-db psql -U aif -d aif -c "COPY tools FROM STDIN" < tools.csv
```

### Scenario: JWT_SECRET lost

All users must re-authenticate. Generate a new one and restart:

```bash
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
# Update backend/.env, then:
docker compose up -d --force-recreate app
```

No data loss, but every session is invalidated.

### Scenario: Database corruption

PostgreSQL does not easily recover from file-level corruption. If `pg_isready` returns healthy but queries fail with corruption errors:

```bash
# 1. Stop db
docker compose stop db

# 2. Snapshot the damaged volume (for forensics)
docker run --rm -v aif_pgdata:/data -v "$(pwd)":/backup alpine \
  tar czf /backup/aif_pgdata-corrupted-$(date +%F).tar.gz -C /data .

# 3. Restore from last good pg_dump backup (procedure above)
```

## Testing Backups

Backups that are never tested are not backups. Quarterly procedure:

```bash
# 1. Create throwaway stack
cp -r /path/to/aif /tmp/aif-restore-test
cd /tmp/aif-restore-test

# 2. Use different container names / ports
sed -i 's/aif-app/aif-restore-app/g; s/aif-db/aif-restore-db/g; s/3300:/3301:/g' docker-compose.yml

# 3. Restore latest backup into this stack

# 4. Verify:
# - Health check returns 200
# - Log in as admin
# - Confirm recent tool list matches expectation
# - Check audit log for recent entries
# - Run one pipeline against a known codebase

# 5. Tear down
docker compose down -v
rm -rf /tmp/aif-restore-test
```

Document the test outcome. Any failures should block promotion of new backup procedures to production.

## Cross-Institution Migration

When porting an AIF deployment to a new institution:

- **Do not** restore the db dump. It contains institution-specific user identities, tool submissions, and audit history.
- **Do** copy `backend/.env.example` and adapt.
- Deploy fresh; let the first user bootstrap as admin.

For a test or sandbox copy of production:

```bash
# Dump only the schema, not data
docker exec aif-db pg_dump -U aif -d aif --schema-only > schema.sql
```

## Related

- [Deployment](deployment.md) — initial setup
- [Data Retention](data-retention.md) — pre-purge backup recommendation
- [Troubleshooting](troubleshooting.md) — when to reach for backups
