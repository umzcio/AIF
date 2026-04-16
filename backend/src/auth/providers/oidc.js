/**
 * OIDC Auth Provider (stub)
 *
 * OpenID Connect — works with Entra ID (Azure AD), Okta, Google, Keycloak,
 * Auth0, and any standard OIDC provider.
 *
 * Required env:
 *   OIDC_ISSUER        — e.g. https://login.microsoftonline.com/{tenant}/v2.0
 *   OIDC_CLIENT_ID     — application/client ID
 *   OIDC_CLIENT_SECRET — client secret
 *   OIDC_REDIRECT_URI  — callback URL, e.g. https://your-domain.edu/aif/api/auth/callback
 *
 * Optional env:
 *   OIDC_SCOPE          — space-separated scopes (default: "openid profile email")
 *   OIDC_USER_CLAIM     — claim to use as netid (default: "preferred_username")
 *   OIDC_NAME_CLAIM     — claim to use as display name (default: "name")
 *   OIDC_LOGOUT_URL     — end_session_endpoint override
 *
 * Implementation notes:
 *   This will need the `openid-client` npm package (lightweight, no passport dependency).
 *   The flow: redirect to authorize endpoint → callback receives code → exchange for tokens →
 *   extract identity from id_token claims.
 */

export default {
  name: "oidc",

  getLoginUrl() {
    throw new Error("OIDC provider not yet implemented. Install openid-client and complete auth/providers/oidc.js");
  },

  async authenticate() {
    throw new Error("OIDC provider not yet implemented");
  },

  getLogoutUrl() {
    return process.env.OIDC_LOGOUT_URL || null;
  },
};
