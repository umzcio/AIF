# Authentication

Routes mounted under `/aif/api/auth`. Authentication is delegated to a pluggable provider (CAS by default; OIDC, SAML, header, and dev-only bypass are also supported). The portal issues its own JWT session cookie on successful identity assertion.

See [overview.md](overview.md) for the shared auth cookie, CSRF, and rate-limit rules. Note that `/auth/*` has a stricter rate limit: **30 requests per 15 minutes per IP**.

## Session Cookie

The session cookie is named `aif_token`. It is set by the `/auth/callback` handler after the provider asserts an identity, and is re-issued by `/auth/refresh`. The JWT payload contains `{ userId, netid, role, displayName }`.

## Endpoints

### GET /auth/login

Initiates a login. Behavior depends on the configured provider:

- **Redirect-based providers** (CAS, OIDC, SAML): the response is a 302 redirect to the external identity provider's login URL. After the user authenticates there, the IdP redirects to `/auth/callback`.
- **Direct-auth providers** (`bypass`, `header`): the request is authenticated inline. On success the server sets the `aif_token` cookie and issues a 302 to the frontend. On failure it redirects with `?error=auth_failed` or `?error=auth_error` in the query string.

**Auth**: Public. **CSRF**: Exempt.

**Response**: `302 Found` with `Location` header. No JSON body.

**Errors**: Errors are surfaced as query-string parameters on the frontend redirect, not as HTTP error status codes.

### GET /auth/callback

Completes the login flow for redirect-based providers. Expects the provider-specific parameters (e.g. `ticket` for CAS, `code` for OIDC) on the query string. On successful identity validation, the server upserts the user into the `users` table, issues a JWT, sets the `aif_token` cookie, and redirects to the configured frontend URL.

**Auth**: Public. **CSRF**: Exempt.

**Upsert behavior**:

- The very first user created in the database is promoted to `admin`.
- Any netid listed in `ADMIN_NETIDS` is promoted to `admin`.
- All other new users are assigned the `builder` role.
- Existing users are updated with a fresh `last_login` timestamp.

**Response**: `302 Found` with `Location` header.

**Errors**: On validation failure, redirects to the frontend with `?error=validation_failed`. On unexpected error, redirects with `?error=auth_error`.

### POST /auth/logout

Clears the `aif_token` cookie. If the configured provider publishes a logout URL (for example, CAS's single logout endpoint), it is returned in the response so the client can redirect the browser to complete the SSO-wide logout.

**Auth**: Public (operates on the caller's cookie). **CSRF**: Required.

**Request body**: None.

**Response** `200 OK`:

```json
{ "success": true }
```

Or, when an upstream logout URL is configured:

```json
{ "success": true, "casLogoutUrl": "https://login.example.edu/cas/logout" }
```

### GET /auth/status

Reports whether the caller has a valid session cookie. Does not refresh the cookie or re-read the user from the database.

**Auth**: Public. **CSRF**: Exempt (GET).

**Response** `200 OK`:

```json
{
  "authenticated": true,
  "user": {
    "userId": 42,
    "netid": "jdoe",
    "role": "builder",
    "displayName": "Jane Doe"
  }
}
```

**Errors**:

- `401 Unauthorized` — no cookie, or the JWT failed verification
  ```json
  { "authenticated": false }
  ```

### GET /auth/refresh

Re-reads the user row from the database and issues a fresh JWT. Use this after role or active-status changes so the session reflects the new permissions without requiring the user to log out and back in. If the user is no longer active (`is_active = false`) the cookie is cleared and the call returns 401.

**Auth**: Requires a currently valid `aif_token` cookie. **CSRF**: Exempt (GET).

**Response** `200 OK`:

```json
{
  "authenticated": true,
  "user": {
    "netid": "jdoe",
    "role": "reviewer",
    "userId": 42,
    "displayName": "Jane Doe"
  }
}
```

The response also sets a new `aif_token` cookie.

**Errors**:

- `401 Unauthorized` — no cookie, expired token, or user deactivated
  ```json
  { "authenticated": false }
  ```

## Typical Flows

### Browser SSO

```
1.  User clicks "Login"
2.  GET /aif/api/auth/login             → 302 https://idp.example.edu/...
3.  User authenticates at IdP
4.  IdP → GET /aif/api/auth/callback?ticket=...
                                         → Set-Cookie: aif_token=...
                                         → 302 /aif
5.  Frontend loads authenticated
```

### Silent Refresh After Role Change

```
Admin promotes user to reviewer
User's next page load calls GET /auth/refresh
Server re-reads role from DB and issues a new JWT
```

### Logout

```
POST /aif/api/auth/logout
    → clears aif_token
    → { "success": true, "casLogoutUrl": "..." }
Frontend redirects browser to casLogoutUrl if present
```

## Related

- [overview.md](overview.md) — cookie attributes, CSRF, rate limits
- [admin.md](admin.md) — role changes that trigger the need for `/auth/refresh`
