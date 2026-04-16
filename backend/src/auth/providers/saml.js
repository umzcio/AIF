/**
 * SAML Auth Provider (stub)
 *
 * SAML 2.0 — works with ADFS, Shibboleth IdP, Okta, OneLogin,
 * and any standard SAML 2.0 identity provider.
 *
 * Required env:
 *   SAML_ENTRY_POINT   — IdP SSO URL, e.g. https://idp.example.edu/idp/profile/SAML2/Redirect/SSO
 *   SAML_ISSUER        — SP entity ID, e.g. "aif-portal"
 *   SAML_CERT          — IdP signing certificate (PEM string, or path via SAML_CERT_PATH)
 *   SAML_CALLBACK_URL  — ACS URL, e.g. https://your-domain.edu/aif/api/auth/callback
 *
 * Optional env:
 *   SAML_CERT_PATH     — path to IdP cert file (alternative to inline SAML_CERT)
 *   SAML_USER_ATTR     — SAML attribute for netid (default: "uid")
 *   SAML_NAME_ATTR     — SAML attribute for display name (default: "displayName")
 *   SAML_LOGOUT_URL    — IdP SLO URL
 *
 * Implementation notes:
 *   This will need the `@node-saml/node-saml` npm package.
 *   The flow: redirect to IdP → IdP posts SAMLResponse to callback →
 *   validate signature + extract attributes → return identity.
 */

export default {
  name: "saml",

  getLoginUrl() {
    throw new Error("SAML provider not yet implemented. Install @node-saml/node-saml and complete auth/providers/saml.js");
  },

  async authenticate() {
    throw new Error("SAML provider not yet implemented");
  },

  getLogoutUrl() {
    return process.env.SAML_LOGOUT_URL || null;
  },
};
