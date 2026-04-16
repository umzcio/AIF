# User Management

AIF uses role-based access control with three roles: `builder`, `reviewer`, and `admin`. Users are auto-provisioned from the configured SSO on first login; administrators manage role assignment and account activation through the Users tab of the Admin Dashboard.

## Roles

| Role | Can do |
|------|--------|
| `builder` | Submit tools, upload codebases, view own submissions, see active/approved tools |
| `reviewer` | All builder capabilities plus: view all tools, approve/request changes, override track, add review notes |
| `admin` | All reviewer capabilities plus: manage users, view audit log, trigger retention, view analytics |

Roles are enforced at the API layer via `requireRole()` middleware and at the database layer via role-scoped queries (see `backend/src/routes/registry.js`).

A user always has exactly one role. Roles are not additive. An admin who needs to review a tool does so with admin privileges.

## User Table Schema

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  netid VARCHAR(50) UNIQUE NOT NULL,
  display_name VARCHAR(255),
  role VARCHAR(20) NOT NULL DEFAULT 'builder'
    CHECK (role IN ('builder', 'reviewer', 'admin')),
  email VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  notify_email BOOLEAN DEFAULT false,
  notify_in_app BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ
);
```

`netid` is the unique username from the SSO provider. `display_name` is read from the SSO attributes on first login and not updated thereafter.

## Auto-Provisioning

Users are created on their first successful SSO login. The logic in `backend/src/routes/auth.js`:

```javascript
const { rows: [{ count }] } = await pool.query("SELECT COUNT(*) FROM users");
const isFirstUser = parseInt(count) === 0;
const isAdminNetid = ADMIN_NETIDS.includes(netid);
const role = (isFirstUser || isAdminNetid) ? "admin" : "builder";
```

### First User

The very first user to log in to a fresh deployment is automatically granted the `admin` role. This bootstraps the system without requiring a manual database edit.

If no users exist yet, log in once as the person who should hold the admin role. They will be created as admin.

### ADMIN_NETIDS Environment Variable

Any netid listed in the `ADMIN_NETIDS` env var receives the admin role on first login. This is intended for ongoing administration and does not require the user to be the first to log in.

```bash
# backend/.env
ADMIN_NETIDS=alice,bob,charlie
```

`ADMIN_NETIDS` is consulted only at user creation. Changing it after a user exists does not change their role; use the UI or a SQL update to change an existing user's role.

`ADMIN_NETIDS` does not downgrade existing admins if their netid is removed.

## Promoting a User to Reviewer or Admin

### Via UI

1. Navigate to the Admin Dashboard, Users tab.
2. Locate the user by name or netid.
3. Change the role via the Role dropdown.
4. Confirm the change in the dialog.

The new role takes effect on the user's next page load (their JWT is issued with the role encoded in it; existing tokens carry the old role until refresh).

### Via API

```bash
curl -X PATCH https://example.edu/aif/api/admin/users/42/role \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: $CSRF" \
  --cookie "aif_token=$JWT; aif_csrf=$CSRF" \
  -d '{"role":"reviewer"}'
```

Role changes are audited. The audit_log entry records:

| Field | Value |
|-------|-------|
| `action` | `change_role` |
| `entity_type` | `user` |
| `entity_id` | Target user ID |
| `details.from` | Previous role |
| `details.to` | New role |
| `details.targetNetid` | Target user netid |
| `details.ip` | Actor's IP |

## Deactivating a User

Deactivated users cannot log in. Their existing tool submissions remain in the registry and their audit history is preserved.

### Via UI

1. Users tab → locate user.
2. Click the Active toggle.
3. Confirm in the dialog.

### Via API

```bash
curl -X PATCH https://example.edu/aif/api/admin/users/42/active \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: $CSRF" \
  --cookie "aif_token=$JWT; aif_csrf=$CSRF" \
  -d '{"active":false}'
```

### Constraints

- Administrators cannot deactivate themselves. The endpoint returns HTTP 400 if `targetUserId === currentUserId`.
- A deactivated user's tools are not automatically transferred. If the user owned tools that should be reviewed, reassign ownership with a SQL update:

```sql
UPDATE tools SET owner_id = (SELECT id FROM users WHERE netid = 'new-owner')
WHERE owner_id = (SELECT id FROM users WHERE netid = 'departing-user');
```

- Deactivation is reversible. Toggle the Active switch to reactivate.

## Reviewer Assignment

AIF does not support per-tool reviewer assignment. Any user with the reviewer or admin role can review any Track 3 or Track 4 tool. To distribute review workload, use notifications: reviewers receive in-app (and email, if enabled) notifications for new Track 2-4 completions.

See the `notifyRole({ role: "reviewer", ... })` call in `backend/src/pipeline/queue.js` for the notification trigger.

## Listing Users

The Users tab shows:

| Column | Source |
|--------|--------|
| Name | `display_name` |
| NetID | `netid` |
| Role | `role` (editable) |
| Last Login | `last_login` |
| Tools | Count of owned tools |
| Active | `is_active` (editable) |

Users are sorted by `created_at DESC` (newest first).

For programmatic access:

```bash
curl https://example.edu/aif/api/admin/users --cookie "aif_token=$JWT"
```

## Changing a User's NetID

This is not supported through the UI and should be done only when an institution renames a netid. Update directly in SQL:

```sql
BEGIN;
UPDATE users SET netid = 'new-netid' WHERE netid = 'old-netid';
UPDATE audit_log SET actor_netid = 'new-netid' WHERE actor_netid = 'old-netid';
COMMIT;
```

This preserves the user ID, audit trail, and all owned tools. Notify the user that their cookie may be invalidated and they will need to log in again.

## Manual User Insertion

For institutions that use `AUTH_PROVIDER=header` or a custom SSO integration, users can be pre-provisioned:

```sql
INSERT INTO users (netid, display_name, role)
VALUES ('alice', 'Alice Administrator', 'admin');
```

The user must still log in successfully at least once for `last_login` to populate and for them to use the portal.

## Related

- [Audit Log](audit-log.md) — every role and activation change is audited
- [System Dashboard](system-dashboard.md) — user counts and activity
- [Deployment](deployment.md) — `AUTH_PROVIDER` and `ADMIN_NETIDS` configuration
