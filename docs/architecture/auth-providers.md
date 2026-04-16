# Authentication Providers

## Summary

The portal delegates identity to a single SSO provider selected at startup by
the `AUTH_PROVIDER` environment variable. All providers implement a uniform
three-method interface so the login routes in `backend/src/routes/auth.js` are
unaware of the underlying protocol. Five providers exist:

| Provider | Value | Status | Typical use |
|----------|-------|--------|-------------|
| CAS | `cas` | Live | Most U.S. universities |
| Header | `header` | Live | Shibboleth or other reverse-proxy auth |
| OIDC | `oidc` | Stub | Entra ID, Okta, Auth0, Google, Keycloak |
| SAML | `saml` | Stub | ADFS, Shibboleth IdP |
| Bypass | `bypass` | Dev only — blocked in production | Local testing |

After a provider resolves an identity, the route issues a short-lived HS256
JWT in an `aif_token` httpOnly cookie and upserts the user into the `users`
table. RBAC (`builder` / `reviewer` / `admin`) is then handled by Express
middleware independent of the auth source.

## Provider Interface

Every module under `backend/src/auth/providers/` exports a default object
with three methods:

```js
{
  name,               // string, provider identifier
  getLoginUrl(),      // string|null — redirect target, or null for inline auth
  async authenticate(req),  // { netid, displayName } | null — resolve identity from request
  getLogoutUrl(),     // string|null — optional IdP logout URL
}
```

The loader selects one at module load:

```js
// backend/src/auth/providers/index.js
switch (PROVIDER_NAME) {
  case "cas":    provider = (await import("./cas.js")).default;    break;
  case "oidc":   provider = (await import("./oidc.js")).default;   break;
  case "saml":   provider = (await import("./saml.js")).default;   break;
  case "header": provider = (await import("./header.js")).default; break;
  case "bypass": provider = (await import("./bypass.js")).default; break;
  default: throw new Error(`Unknown AUTH_PROVIDER: "${PROVIDER_NAME}"`);
}
```

The backend logs the chosen provider at startup
(`backend/src/auth/providers/index.js:40`) and the preflight check in
`server.js:184-187` echoes it along with the pipeline key count.

## Shared Login Flow

Regardless of provider, login funnels through two routes in
`backend/src/routes/auth.js`:

```
GET /aif/api/auth/login
   ├─ url = provider.getLoginUrl()
   ├─ if url: res.redirect(url)                         ← CAS/OIDC/SAML
   └─ else:                                             ← bypass/header
        identity = await provider.authenticate(req)
        loginAndRedirect(identity, res)

GET /aif/api/auth/callback
   ├─ identity = await provider.authenticate(req)
   └─ loginAndRedirect(identity, res)
```

`loginAndRedirect()` (`auth.js:36-42`):

```
upsertUser(netid, displayName)
  ├─ first user ever OR netid in ADMIN_NETIDS → role='admin'
  ├─ ON CONFLICT UPDATE display_name, email, last_login
token = generateToken(user)       // jose HS256, 24h default
res.cookie("aif_token", token, { httpOnly, secure, sameSite: 'lax' })
res.redirect(FRONTEND_URL || BASE_PATH)
```

The cookie scope is `BASE_PATH` so the token is not sent to unrelated apps on
the same host (relevant for the shared nginx reverse proxy).

## CAS Provider

`backend/src/auth/providers/cas.js` implements the CAS 2.0 redirect +
ticket-validation flow.

```
Required env:
  CAS_BASE_URL        e.g. https://login.example.edu/cas
  CAS_SERVICE_URL     https://your-host/aif/api/auth/callback

Optional env:
  CAS_LOGOUT_URL      defaults to {CAS_BASE_URL.replace('/cas','')}/idp/profile/cas/logout
```

### Flow

```
Browser                          Portal                           CAS Server
   │                               │                                 │
   │  GET /aif/api/auth/login      │                                 │
   ├──────────────────────────────▶│                                 │
   │  302 {CAS_BASE_URL}/login?service=...                           │
   │◀──────────────────────────────┤                                 │
   │                               │                                 │
   │  GET .../cas/login?service=... (user enters creds)              │
   ├────────────────────────────────────────────────────────────────▶│
   │                               │                                 │
   │  302 {CAS_SERVICE_URL}?ticket=ST-...                            │
   │◀────────────────────────────────────────────────────────────────┤
   │                               │                                 │
   │  GET /aif/api/auth/callback?ticket=ST-...                       │
   ├──────────────────────────────▶│                                 │
   │                               │  GET {CAS_BASE_URL}/serviceValidate?ticket=...&service=...
   │                               ├────────────────────────────────▶│
   │                               │  <cas:serviceResponse>...       │
   │                               │◀────────────────────────────────┤
   │                               │  parseCASXML → { netid, displayName }
   │                               │  upsert user, sign JWT, set cookie
   │  302 {FRONTEND_URL or BASE}   │                                 │
   │◀──────────────────────────────┤                                 │
```

`parseCASXML` handles both CAS 2.0 (`<cas:user>...`) with optional
`<cas:commonName>` / `<cas:displayName>`, and CAS 1.0 (`yes\n<netid>`) as a
fallback. Ticket validation is a single server-to-server `fetch` with no
library dependency.

### Logout

`POST /aif/api/auth/logout` clears the local cookie and returns
`{ success: true, casLogoutUrl }` so the frontend can redirect to the IdP's
logout endpoint.

## Header Provider

`backend/src/auth/providers/header.js` reads identity from HTTP headers set
by a reverse proxy. Typical deployment is Shibboleth via mod_shib:

```
Required env:
  AUTH_HEADER_USER             header name (e.g. "REMOTE_USER", "X-Remote-User")

Optional env:
  AUTH_HEADER_DISPLAY_NAME     header name for the user's display name
```

`getLoginUrl()` returns `null` — there is no redirect, the proxy has already
authenticated the request. `authenticate(req)` reads the configured header
(lowercased to match Node's header normalization) and returns
`{ netid, displayName }`. If the header is missing the user is treated as
unauthenticated and the login route falls through to the error redirect.

Because the proxy is trusted, deployments using this provider must configure
nginx / Apache to strip the configured headers from untrusted sources.

## Bypass Provider

`backend/src/auth/providers/bypass.js` returns a hardcoded `dev` identity
without any external request.

```js
async authenticate() {
  return { netid: "dev", displayName: "Dev User" };
}
```

The middleware guards against production use
(`backend/src/auth/middleware.js:9-12`):

```js
if (AUTH_PROVIDER === "bypass" && IS_PRODUCTION) {
  log.error("AUTH_PROVIDER=bypass cannot be used in production — ignoring");
}
const AUTH_BYPASS = AUTH_PROVIDER === "bypass" && !IS_PRODUCTION;
```

The legacy `AUTH_BYPASS=true` env var remains as an alias for
`AUTH_PROVIDER=bypass` (`backend/src/config.js:9`).

## OIDC Provider (Stub)

`backend/src/auth/providers/oidc.js` declares the contract but throws on
call. Required env (documented in the file):

```
OIDC_ISSUER            e.g. https://login.microsoftonline.com/{tenant}/v2.0
OIDC_CLIENT_ID
OIDC_CLIENT_SECRET
OIDC_REDIRECT_URI      https://your-host/aif/api/auth/callback

Optional:
OIDC_SCOPE             default "openid profile email"
OIDC_USER_CLAIM        default "preferred_username"
OIDC_NAME_CLAIM        default "name"
OIDC_LOGOUT_URL
```

Implementation notes in the stub recommend the `openid-client` npm package
(lightweight, no passport dependency). The flow will be:

1. `getLoginUrl()` — construct authorize endpoint URL with state + nonce
2. `authenticate(req)` on callback — exchange `code` for tokens, validate
   `id_token`, extract `OIDC_USER_CLAIM` as `netid`, `OIDC_NAME_CLAIM` as
   `displayName`
3. `getLogoutUrl()` — end_session_endpoint from discovery or env override

## SAML Provider (Stub)

`backend/src/auth/providers/saml.js` declares the contract but throws on
call. Required env:

```
SAML_ENTRY_POINT       IdP SSO URL
SAML_ISSUER            SP entity ID (e.g. "aif-portal")
SAML_CERT              IdP signing certificate (PEM string)
SAML_CALLBACK_URL      ACS URL

Optional:
SAML_CERT_PATH         path alternative to inline SAML_CERT
SAML_USER_ATTR         default "uid"
SAML_NAME_ATTR         default "displayName"
SAML_LOGOUT_URL
```

Implementation will use `@node-saml/node-saml`. The flow: redirect to IdP →
IdP posts a `SAMLResponse` to the ACS callback → validate the signature →
extract attributes → return identity.

## Role Assignment

The same rules apply across all providers (`backend/src/routes/auth.js:16-34`):

1. If the `users` table is empty, the first login gets `role = 'admin'`
   (bootstrap).
2. If the netid is in `ADMIN_NETIDS` (comma-separated env var), the user
   gets `role = 'admin'`.
3. Otherwise the user gets `role = 'builder'`.
4. Existing users never have their role downgraded by re-login — only
   `display_name`, `email`, and `last_login` are updated.

Role changes post-bootstrap happen through the admin UI which writes to the
`users` table and is logged to `audit_log`.

## JWT Details

`backend/src/auth/jwt.js` uses `jose` with HS256. The secret comes from
`JWT_SECRET` (fatal if missing). Token claims:

```json
{
  "netid": "string",
  "role": "builder|reviewer|admin",
  "userId": 42,
  "displayName": "string",
  "iss": "aif-portal",
  "aud": "aif-users",
  "iat": ..., "exp": ...
}
```

Expiry is `JWT_EXPIRY` env var (default `24h`). The refresh endpoint
(`GET /aif/api/auth/refresh` in `routes/auth.js:99-120`) re-reads the user
from the database and re-signs, so a role change takes effect on the next
page load.

## Cross-references

- Request-level auth middleware and RBAC factories: [backend.md](./backend.md)
- CSRF double-submit cookie layered on top of the JWT:
  [security.md](./security.md)
- Where `role` gates each route: [backend.md](./backend.md)
