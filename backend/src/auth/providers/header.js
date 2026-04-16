/**
 * Header Auth Provider
 *
 * For reverse proxy authentication (Shibboleth/mod_shib, Apache mod_auth,
 * Nginx auth_request, etc.). The proxy authenticates the user and sets
 * headers on every request. No redirect needed.
 *
 * Required env:
 *   AUTH_HEADER_USER  — header name containing the username (e.g. "REMOTE_USER", "X-Remote-User")
 *
 * Optional env:
 *   AUTH_HEADER_DISPLAY_NAME — header name for display name (e.g. "X-Display-Name", "displayName")
 */

const HEADER_USER = process.env.AUTH_HEADER_USER;
const HEADER_DISPLAY_NAME = process.env.AUTH_HEADER_DISPLAY_NAME || "";

if (!HEADER_USER) {
  throw new Error("AUTH_PROVIDER=header requires AUTH_HEADER_USER to be set (e.g. REMOTE_USER)");
}

export default {
  name: "header",

  getLoginUrl() {
    return null; // no redirect — proxy handles auth
  },

  async authenticate(req) {
    const netid = req.headers[HEADER_USER.toLowerCase()];
    if (!netid) return null;

    const displayName = HEADER_DISPLAY_NAME
      ? req.headers[HEADER_DISPLAY_NAME.toLowerCase()] || null
      : null;

    return { netid: netid.trim(), displayName };
  },

  getLogoutUrl() {
    return null;
  },
};
