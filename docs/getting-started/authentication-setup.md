# Authentication Setup

## Summary

AIF uses a pluggable authentication model. A single environment variable, `AUTH_PROVIDER`, selects which provider module is loaded at boot. Five providers ship with the application: `bypass` (development), `cas` (live), `header` (live, for reverse-proxy authentication), `oidc` (stub), and `saml` (stub). Each provider implements three functions (`getLoginUrl`, `authenticate`, `getLogoutUrl`) and reads its own configuration from the environment. This document walks through the setup for each, followed by verification steps and a shared post-login behavior reference.

## Provider matrix

| Provider | Status | Use case | Required env |
|----------|--------|----------|--------------|
| `bypass` | Live (dev-only) | Local development | *(none)* |
| `cas` | Live | Universities with CAS (Apereo, Shibboleth CAS) | `CAS_BASE_URL`, `CAS_SERVICE_URL` |
| `header` | Live | Shibboleth SP, Apache `mod_shib`, nginx `auth_request` | `AUTH_HEADER_USER` |
| `oidc` | Stub | Entra ID, Okta, Google, Keycloak, Auth0 | Planned: `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI` |
| `saml` | Stub | ADFS, Shibboleth IdP (SAML), OneLogin | Planned: `SAML_ENTRY_POINT`, `SAML_ISSUER`, `SAML_CERT`, `SAML_CALLBACK_URL` |

The default is `cas`. Setting `AUTH_BYPASS=true` is a legacy alias that forces `bypass`.

For architectural detail on the provider interface and how to implement a new one, see [../architecture/auth-providers.md](../architecture/auth-providers.md).

## Shared post-login behavior

Every provider returns an identity object of the form `{ netid, displayName }` from its `authenticate()` method. The auth routes in `backend/src/routes/auth.js` then:

1. Upsert the user into the `users` table.
2. Assign the `admin` role if the table was empty (first user) or if `netid` appears in `ADMIN_NETIDS`; otherwise `builder`.
3. If the provider did not supply an email and `INSTITUTION_DOMAIN` is set, populate `email = <netid>@<INSTITUTION_DOMAIN>`.
4. Sign a JWT, set the `aif_token` cookie (httpOnly, Secure, SameSite=Lax, path=`/aif`), and redirect to `FRONTEND_URL` (or `BASE_PATH` when unset).

This behavior is identical across providers. Provider setup only controls how the initial identity is obtained.

---

## Provider: `bypass` (development)

### When to use

Local development, CI smoke tests, demos. This provider is blocked in production: when `NODE_ENV=production` and `AUTH_PROVIDER=bypass`, the middleware logs an error and ignores the setting.

### Configuration

```
AUTH_PROVIDER=bypass
```

No other variables are required.

### Behavior

On first request, the middleware inserts a user with `netid=dev`, `display_name=Dev User`, `role=admin` and caches it in memory. Every subsequent request is authenticated as that user. There is no login page and no logout flow — logging out clears the cookie but the next request re-authenticates immediately.

---

## Provider: `cas`

### When to use

Institutions running a CAS server (Apereo CAS, Shibboleth CAS endpoint, or any CAS 2.0-compatible IdP).

### Required configuration

| Name | Example | Purpose |
|------|---------|---------|
| `AUTH_PROVIDER` | `cas` | Selects the CAS provider. |
| `CAS_BASE_URL` | `https://login.example.edu/cas` | Base URL of the CAS server. The provider appends `/login` and `/serviceValidate` to this. |
| `CAS_SERVICE_URL` | `https://aif.example.edu/aif/api/auth/callback` | Exact callback URL registered with CAS. Must match what CAS sends the ticket back to. |

### Optional configuration

| Name | Default | Purpose |
|------|---------|---------|
| `CAS_LOGOUT_URL` | `${CAS_BASE_URL without /cas}/idp/profile/cas/logout` | URL the frontend directs users to on logout. Override when your IdP uses a non-standard logout path. |

### URL shape reference

Most CAS deployments expose one of these URL patterns. Confirm with your IdP operator.

| Institution pattern | Example |
|---------------------|---------|
| Apereo CAS standalone | `https://login.example.edu/cas` |
| Shibboleth IdP with CAS endpoint | `https://login.example.edu/idp/profile/cas` |
| Subpath deployment | `https://sso.example.edu/cas` |

`CAS_SERVICE_URL` must be the publicly reachable URL that the user's browser can POST back to, including the `BASE_PATH` (`/aif`) and the literal path `/api/auth/callback`.

### Setup steps

1. Register the service URL with your CAS operator. Some deployments require an allowlist; others accept any service URL.
2. Set the three required environment variables in `backend/.env`.
3. Restart the container: `docker compose up -d`.
4. Verify the preflight log shows `"auth":"cas"`.

### Verify it works

Trigger the login flow from a browser:

```
https://aif.example.edu/aif/api/auth/login
```

Expected sequence:

1. HTTP 302 redirect to `https://login.example.edu/cas/login?service=<url-encoded CAS_SERVICE_URL>`.
2. User authenticates at the CAS login page.
3. CAS redirects back to `CAS_SERVICE_URL` with a `?ticket=ST-...` query parameter.
4. AIF validates the ticket against `${CAS_BASE_URL}/serviceValidate`, parses the CAS 2.0 XML response, and sets the `aif_token` cookie.
5. Browser lands on `FRONTEND_URL` with the user logged in.

Server-side confirmation:

```
docker logs aif-app 2>&1 | grep "Auth success"
```

Expected:

```
{"level":"info","msg":"Auth success","netid":"jdoe","role":"admin","provider":"cas"}
```

### Common failures

- **`AUTH_PROVIDER=cas requires CAS_BASE_URL to be set`** — `CAS_BASE_URL` is missing. Container will exit on startup.
- **Redirect loop** — `CAS_SERVICE_URL` does not match the URL your browser is hitting. Check for `http` vs `https`, trailing slashes, and subpath prefix.
- **`validation_failed` in URL** — Ticket validation returned an error. Confirm the service URL is registered with CAS and that the validation endpoint (`${CAS_BASE_URL}/serviceValidate`) is reachable from the container.

---

## Provider: `header`

### When to use

When authentication is terminated at a reverse proxy (Shibboleth SP via `mod_shib`, nginx `auth_request`, Apache `mod_auth_*`, or a commercial SSO gateway) and the proxy injects the authenticated username as an HTTP header on every request.

### Required configuration

| Name | Example | Purpose |
|------|---------|---------|
| `AUTH_PROVIDER` | `header` | Selects the header provider. |
| `AUTH_HEADER_USER` | `REMOTE_USER` | Name of the header containing the username. Read case-insensitively. |

### Optional configuration

| Name | Example | Purpose |
|------|---------|---------|
| `AUTH_HEADER_DISPLAY_NAME` | `displayName` | Name of the header containing the user's display name. |

### Setup steps

1. Place AIF behind a reverse proxy that terminates authentication. The proxy must:
   - Authenticate every request to `/aif/`.
   - Strip any pre-existing value of the configured header from the incoming client request (prevent spoofing).
   - Set the header to the authenticated username on forwarded requests.
2. Set the environment variables in `backend/.env`.
3. Restart the container.

### Typical reverse-proxy configurations

**nginx with `auth_request`:**

```nginx
location /aif/ {
  auth_request /auth/validate;
  auth_request_set $auth_user $upstream_http_x_remote_user;
  proxy_set_header X-Remote-User $auth_user;
  proxy_pass http://aif-app:3000;
}
```

Pair with `AUTH_HEADER_USER=X-Remote-User`.

**Apache with `mod_shib` (Shibboleth SP):**

```apache
<Location /aif>
  AuthType shibboleth
  ShibRequestSetting requireSession 1
  Require valid-user
  RequestHeader set X-Remote-User %{eppn}e
  RequestHeader set X-Display-Name %{displayName}e
  ProxyPass http://aif-app:3000/aif
</Location>
```

Pair with `AUTH_HEADER_USER=X-Remote-User` and `AUTH_HEADER_DISPLAY_NAME=X-Display-Name`.

> **Security note.** The header provider trusts the reverse proxy unconditionally. Any request reaching the container with the configured header set will be authenticated as that user. Do not expose the container directly on any network that bypasses the proxy. Bind the container port to `127.0.0.1` when running on a shared host, or place it on a private Docker network reachable only from the proxy.

### Verify it works

Send a request with the configured header:

```
curl -i -H "X-Remote-User: jdoe" http://localhost:3300/aif/api/auth/login
```

Expected response: HTTP 302 redirect to `FRONTEND_URL` with `Set-Cookie: aif_token=...`.

Without the header:

```
curl -i http://localhost:3300/aif/api/auth/login
```

Expected response: HTTP 302 redirect to `FRONTEND_URL?error=auth_failed`.

---

## Provider: `oidc` (stub)

### Status

**Not implemented.** The provider file exists and `AUTH_PROVIDER=oidc` loads it, but `getLoginUrl()` and `authenticate()` throw `Error: OIDC provider not yet implemented`. Completing the implementation requires adding the `openid-client` npm package and finishing `backend/src/auth/providers/oidc.js`.

### Planned configuration

When implemented, the following variables will be read:

| Name | Required | Default | Purpose |
|------|----------|---------|---------|
| `OIDC_ISSUER` | Yes | *(none)* | OIDC issuer URL. For Entra ID: `https://login.microsoftonline.com/{tenant}/v2.0`. |
| `OIDC_CLIENT_ID` | Yes | *(none)* | Application (client) ID registered with the IdP. |
| `OIDC_CLIENT_SECRET` | Yes | *(none)* | Client secret. |
| `OIDC_REDIRECT_URI` | Yes | *(none)* | Callback URL registered with the IdP. |
| `OIDC_SCOPE` | No | `openid profile email` | Space-separated scopes. |
| `OIDC_USER_CLAIM` | No | `preferred_username` | Claim used as `netid`. |
| `OIDC_NAME_CLAIM` | No | `name` | Claim used as display name. |
| `OIDC_LOGOUT_URL` | No | *(none)* | End-session endpoint override. |

### Planned flow

1. `GET /aif/api/auth/login` → 302 to IdP authorize endpoint with PKCE.
2. IdP redirects to `OIDC_REDIRECT_URI` with `?code=...`.
3. Server exchanges the code for tokens and extracts identity from `id_token` claims.
4. Shared post-login behavior (upsert, JWT, cookie, redirect) runs as usual.

Track progress at the project's issue tracker. Until implemented, use `cas` or `header` in production.

---

## Provider: `saml` (stub)

### Status

**Not implemented.** The provider file exists and `AUTH_PROVIDER=saml` loads it, but `getLoginUrl()` and `authenticate()` throw `Error: SAML provider not yet implemented`. Completing the implementation requires adding the `@node-saml/node-saml` npm package and finishing `backend/src/auth/providers/saml.js`.

### Planned configuration

| Name | Required | Default | Purpose |
|------|----------|---------|---------|
| `SAML_ENTRY_POINT` | Yes | *(none)* | IdP SSO URL (for example `https://idp.example.edu/idp/profile/SAML2/Redirect/SSO`). |
| `SAML_ISSUER` | Yes | *(none)* | SP entity ID (for example `aif-portal`). |
| `SAML_CERT` | Yes | *(none)* | IdP signing certificate as a PEM string. |
| `SAML_CALLBACK_URL` | Yes | *(none)* | ACS URL (for example `https://aif.example.edu/aif/api/auth/callback`). |
| `SAML_CERT_PATH` | No | *(none)* | Path to a PEM cert file, alternative to inline `SAML_CERT`. |
| `SAML_USER_ATTR` | No | `uid` | SAML attribute for `netid`. |
| `SAML_NAME_ATTR` | No | `displayName` | SAML attribute for display name. |
| `SAML_LOGOUT_URL` | No | *(none)* | IdP SLO URL. |

### Planned flow

1. `GET /aif/api/auth/login` → 302 to IdP `SAML_ENTRY_POINT` with AuthnRequest.
2. IdP posts a SAMLResponse to `SAML_CALLBACK_URL`.
3. Server validates the response signature, extracts the configured user and name attributes, and applies shared post-login behavior.

Until implemented, institutions requiring SAML should place AIF behind a Shibboleth SP and use `AUTH_PROVIDER=header`.

---

## Switching providers

Changing `AUTH_PROVIDER` requires only an environment edit and a container restart; no database migration is needed. Existing user records are keyed by `netid`, so if the new provider emits the same `netid` values as the old one, existing users retain their roles and history.

```
# edit backend/.env to change AUTH_PROVIDER and provider-specific vars
docker compose up -d
```

Confirm the switch in logs:

```
docker logs aif-app 2>&1 | grep "Auth provider loaded"
```

Expected:

```
{"level":"info","msg":"Auth provider loaded","provider":"cas"}
```

## See also

- [installation.md](installation.md) — first-boot walkthrough
- [configuration.md](configuration.md) — full environment variable reference
- [../architecture/auth-providers.md](../architecture/auth-providers.md) — provider interface and implementation guide
- [../admin-guide/user-management.md](../admin-guide/user-management.md) — managing roles after login
