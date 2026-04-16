# Adding an Auth Provider

AIF ships with a pluggable SSO layer. CAS and header-based (Shibboleth/mod_shib) auth are fully implemented; OIDC and SAML are stubbed and awaiting implementation for institutions that need them. This guide explains the provider contract, walks through the CAS reference implementation, and gives step-by-step instructions for completing the OIDC and SAML stubs.

## The Provider Contract

Every provider exports a default object with four members:

```js
export default {
  name: "provider-name",

  // Return the URL the browser should be redirected to for login.
  // Return null if the provider does not require a redirect (e.g. header-based auth).
  getLoginUrl() { /* ... */ },

  // Called on the callback route. Verify the response from the IdP and
  // return { netid, displayName } on success, or null on failure.
  async authenticate(req) { /* ... */ },

  // Return the single-logout URL, or null if the provider has no SLO.
  getLogoutUrl() { /* ... */ },
};
```

The provider is loaded at boot by `backend/src/auth/providers/index.js`, which reads `AUTH_PROVIDER` from the environment and dynamically imports the matching file. Supported values today:

| `AUTH_PROVIDER` | Status | File |
|-----------------|--------|------|
| `cas` | Implemented | `auth/providers/cas.js` |
| `header` | Implemented | `auth/providers/header.js` |
| `bypass` | Implemented (dev only) | `auth/providers/bypass.js` |
| `oidc` | Stub | `auth/providers/oidc.js` |
| `saml` | Stub | `auth/providers/saml.js` |

The loader validates `AUTH_PROVIDER` on startup and throws if it is unrecognised.

## Reference Implementation: CAS

`auth/providers/cas.js` is the reference. It is 67 lines and illustrates every concern you will face in a new provider.

```js
import { CAS_BASE_URL, CAS_SERVICE_URL, CAS_LOGOUT_URL } from "../../config.js";

if (!CAS_BASE_URL) {
  throw new Error("AUTH_PROVIDER=cas requires CAS_BASE_URL to be set");
}

export default {
  name: "cas",

  getLoginUrl() {
    return `${CAS_BASE_URL}/login?service=${encodeURIComponent(CAS_SERVICE_URL)}`;
  },

  async authenticate(req) {
    const ticket = req.query?.ticket;
    if (!ticket) return null;
    const url = `${CAS_BASE_URL}/serviceValidate?ticket=${encodeURIComponent(ticket)}&service=${encodeURIComponent(CAS_SERVICE_URL)}`;
    const resp = await fetch(url);
    const xml = await resp.text();
    return parseCASXML(xml);
  },

  getLogoutUrl() {
    return CAS_LOGOUT_URL || null;
  },
};
```

Notice three patterns that every provider should follow:

1. **Validate required env vars at import time** and throw a descriptive error.
2. **Pull config through `src/config.js`**, not directly from `process.env`. This keeps institution-specific knobs in one place.
3. **Return a plain `{ netid, displayName }` object** — do not return rich IdP objects. The portal persists only those two fields.

## Implementing OIDC

OIDC (OpenID Connect) works with Entra ID (Azure AD), Okta, Google Workspace, Keycloak, Auth0, and any standard OIDC provider. The flow: redirect to the authorize endpoint, receive a `code`, exchange it for an `id_token`, extract claims.

### Step 1: Install the Client Library

```bash
cd backend
npm install openid-client
```

`openid-client` is the reference implementation recommended by the OpenID Foundation. It handles discovery, PKCE, token validation, and JWKS rotation.

### Step 2: Declare Config

Add to `backend/src/config.js`:

```js
export const OIDC_ISSUER = process.env.OIDC_ISSUER;
export const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;
export const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET;
export const OIDC_REDIRECT_URI = process.env.OIDC_REDIRECT_URI;
export const OIDC_SCOPE = process.env.OIDC_SCOPE || "openid profile email";
export const OIDC_USER_CLAIM = process.env.OIDC_USER_CLAIM || "preferred_username";
export const OIDC_NAME_CLAIM = process.env.OIDC_NAME_CLAIM || "name";
export const OIDC_LOGOUT_URL = process.env.OIDC_LOGOUT_URL;
```

### Step 3: Implement the Provider

Replace `backend/src/auth/providers/oidc.js`:

```js
import { Issuer, generators } from "openid-client";
import {
  OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI,
  OIDC_SCOPE, OIDC_USER_CLAIM, OIDC_NAME_CLAIM, OIDC_LOGOUT_URL,
} from "../../config.js";

if (!OIDC_ISSUER) throw new Error("AUTH_PROVIDER=oidc requires OIDC_ISSUER");
if (!OIDC_CLIENT_ID) throw new Error("AUTH_PROVIDER=oidc requires OIDC_CLIENT_ID");
if (!OIDC_CLIENT_SECRET) throw new Error("AUTH_PROVIDER=oidc requires OIDC_CLIENT_SECRET");
if (!OIDC_REDIRECT_URI) throw new Error("AUTH_PROVIDER=oidc requires OIDC_REDIRECT_URI");

// Discover the IdP metadata once at boot.
const issuer = await Issuer.discover(OIDC_ISSUER);
const client = new issuer.Client({
  client_id: OIDC_CLIENT_ID,
  client_secret: OIDC_CLIENT_SECRET,
  redirect_uris: [OIDC_REDIRECT_URI],
  response_types: ["code"],
});

// In-memory state/nonce store. For multi-instance deploys, move to Redis.
const pendingStates = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingStates) if (now - v.created > 10 * 60 * 1000) pendingStates.delete(k);
}, 60 * 1000);

export default {
  name: "oidc",

  getLoginUrl() {
    const state = generators.state();
    const nonce = generators.nonce();
    pendingStates.set(state, { nonce, created: Date.now() });
    return client.authorizationUrl({ scope: OIDC_SCOPE, state, nonce });
  },

  async authenticate(req) {
    const params = client.callbackParams(req);
    const state = params.state;
    const entry = pendingStates.get(state);
    if (!entry) return null;
    pendingStates.delete(state);

    const tokenSet = await client.callback(OIDC_REDIRECT_URI, params, {
      state, nonce: entry.nonce,
    });

    const claims = tokenSet.claims();
    const netid = claims[OIDC_USER_CLAIM];
    const displayName = claims[OIDC_NAME_CLAIM] || null;

    if (!netid) return null;
    return { netid, displayName };
  },

  getLogoutUrl() {
    if (OIDC_LOGOUT_URL) return OIDC_LOGOUT_URL;
    return issuer.metadata.end_session_endpoint || null;
  },
};
```

### Step 4: Configure the Environment

```bash
AUTH_PROVIDER=oidc
OIDC_ISSUER=https://login.microsoftonline.com/{tenant}/v2.0
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
OIDC_REDIRECT_URI=https://your-domain.edu/aif/api/auth/callback
OIDC_USER_CLAIM=preferred_username        # or "upn" or "sub"
OIDC_NAME_CLAIM=name
```

Register the `OIDC_REDIRECT_URI` in your IdP's application/client configuration before starting the server.

### Step 5: Verify

```bash
curl -i http://localhost:3300/api/auth/login
# Expect: 302 Location: https://login.microsoftonline.com/.../authorize?...
```

## Implementing SAML

SAML 2.0 works with ADFS, Shibboleth IdP, Okta (SAML mode), OneLogin, and any SAML 2.0 identity provider. The flow: redirect to SSO URL, IdP POSTs a signed `SAMLResponse` to the ACS URL, the SP verifies the signature and extracts attributes.

### Step 1: Install the Library

```bash
cd backend
npm install @node-saml/node-saml
```

### Step 2: Declare Config

Add to `backend/src/config.js`:

```js
import { readFileSync } from "fs";

export const SAML_ENTRY_POINT = process.env.SAML_ENTRY_POINT;
export const SAML_ISSUER = process.env.SAML_ISSUER;
export const SAML_CALLBACK_URL = process.env.SAML_CALLBACK_URL;
export const SAML_CERT = process.env.SAML_CERT_PATH
  ? readFileSync(process.env.SAML_CERT_PATH, "utf8")
  : process.env.SAML_CERT;
export const SAML_USER_ATTR = process.env.SAML_USER_ATTR || "uid";
export const SAML_NAME_ATTR = process.env.SAML_NAME_ATTR || "displayName";
export const SAML_LOGOUT_URL = process.env.SAML_LOGOUT_URL;
```

### Step 3: Implement the Provider

Replace `backend/src/auth/providers/saml.js`:

```js
import { SAML } from "@node-saml/node-saml";
import {
  SAML_ENTRY_POINT, SAML_ISSUER, SAML_CALLBACK_URL, SAML_CERT,
  SAML_USER_ATTR, SAML_NAME_ATTR, SAML_LOGOUT_URL,
} from "../../config.js";

if (!SAML_ENTRY_POINT) throw new Error("AUTH_PROVIDER=saml requires SAML_ENTRY_POINT");
if (!SAML_ISSUER) throw new Error("AUTH_PROVIDER=saml requires SAML_ISSUER");
if (!SAML_CALLBACK_URL) throw new Error("AUTH_PROVIDER=saml requires SAML_CALLBACK_URL");
if (!SAML_CERT) throw new Error("AUTH_PROVIDER=saml requires SAML_CERT or SAML_CERT_PATH");

const saml = new SAML({
  entryPoint: SAML_ENTRY_POINT,
  issuer: SAML_ISSUER,
  callbackUrl: SAML_CALLBACK_URL,
  idpCert: SAML_CERT,
  signatureAlgorithm: "sha256",
  wantAssertionsSigned: true,
  wantAuthnResponseSigned: true,
});

export default {
  name: "saml",

  async getLoginUrl() {
    return saml.getAuthorizeUrlAsync("/", undefined, {});
  },

  async authenticate(req) {
    // SAML posts to the callback — read from the body, not the query
    const body = req.body || {};
    if (!body.SAMLResponse) return null;

    const { profile } = await saml.validatePostResponseAsync({
      SAMLResponse: body.SAMLResponse,
      RelayState: body.RelayState,
    });
    if (!profile) return null;

    const netid = profile[SAML_USER_ATTR] || profile.nameID;
    const displayName = profile[SAML_NAME_ATTR] || null;
    if (!netid) return null;
    return { netid, displayName };
  },

  getLogoutUrl() {
    return SAML_LOGOUT_URL || null;
  },
};
```

### Step 4: Wire the Callback to Accept POST

The auth callback route in `backend/src/routes/auth.js` currently expects a GET with a query-string ticket. For SAML you need to accept a POST with a URL-encoded body containing `SAMLResponse`.

Update `routes/auth.js` to add a POST handler:

```js
router.post("/callback", urlencoded({ extended: false, limit: "500kb" }), async (req, res) => {
  const identity = await provider.authenticate(req);
  if (!identity) return res.status(401).send("Auth failed");
  // ... existing identity → JWT cookie logic
});
```

Make sure CSRF protection is exempted for this specific route — SAML POSTs arrive from the IdP, not the browser session.

### Step 5: Configure the Environment

```bash
AUTH_PROVIDER=saml
SAML_ENTRY_POINT=https://idp.example.edu/idp/profile/SAML2/Redirect/SSO
SAML_ISSUER=aif-portal                     # your SP entity ID
SAML_CALLBACK_URL=https://your-domain.edu/aif/api/auth/callback
SAML_CERT_PATH=/etc/aif/idp-signing.pem
SAML_USER_ATTR=urn:oid:0.9.2342.19200300.100.1.1   # uid
SAML_NAME_ATTR=urn:oid:2.16.840.1.113730.3.1.241   # displayName
```

Attribute OIDs vary between IdPs. Check your institution's IdP metadata for the correct names. Shibboleth typically uses `urn:oid:` forms; Okta uses friendly names like `email` and `displayName`.

### Step 6: Register the SP with the IdP

Provide the IdP administrator:

- **SP entity ID** — value of `SAML_ISSUER`
- **ACS URL** — value of `SAML_CALLBACK_URL`
- **Binding** — HTTP-POST
- **NameID format** — persistent, or whatever your institution standardises on
- **Required attributes** — `uid` (or equivalent) and `displayName`

## Adding a Wholly New Provider

If your institution uses something exotic — Kerberos, a custom proprietary SSO, etc. — the pattern is identical:

1. Create `backend/src/auth/providers/<name>.js` implementing the four-method contract
2. Add the env-var loader to `backend/src/config.js`
3. Add a `case "<name>":` branch to the switch in `backend/src/auth/providers/index.js`
4. Document required env vars in `backend/.env.example`
5. Update [architecture/auth.md](../architecture/auth.md) with the new provider

Keep institution-specific credentials out of the provider file itself. Every knob should be an env var. This is what makes AIF portable.

## Auth Middleware

Once `authenticate()` returns an identity, `src/auth/middleware.js` handles JWT issuance and verification. You do not need to touch it when adding a provider. The middleware:

- Signs a JWT cookie scoped to the session
- Verifies it on every subsequent request
- Exposes `req.user = { netid, displayName, role, ip }` to route handlers
- Enforces RBAC through `requireRole(...)` and `requireOwnerOrRole(...)`

See [architecture/auth.md](../architecture/auth.md) for the full auth request lifecycle.

## Testing Your Provider

1. Start the backend with `AUTH_PROVIDER=your-provider` set
2. Confirm the startup log line: `Auth provider loaded { provider: "your-provider" }`
3. `curl -i http://localhost:3300/api/auth/login` — expect a 302 redirect to your IdP
4. Complete the IdP flow in a browser
5. Confirm a session cookie is set and `GET /api/auth/me` returns your identity

There is no automated test for auth providers — the IdP side is inherently out-of-process. Manual verification against a staging IdP is the correct approach.

## Security Checklist

- Validate every env var at import time. Fail loudly, do not silently default to insecure values.
- Never log the raw token, SAMLResponse, or client secret. Log only the resolved `netid`.
- Enforce HTTPS on callback URLs in production.
- Pin dependencies. `openid-client` and `@node-saml/node-saml` have had security advisories — subscribe to their release feeds.
- Rate-limit the login and callback routes. The existing `express-rate-limit` middleware (30 requests per 15 minutes on `/auth/*`) already covers this.

## Related Reference

- [architecture/auth.md](../architecture/auth.md) — auth request lifecycle, JWT handling, RBAC model
- [setup.md](setup.md) — local development uses `AUTH_PROVIDER=bypass`
- [contributing.md](contributing.md) — PR checklist, testing expectations
