/**
 * Bypass Auth Provider
 *
 * Development-only — auto-authenticates as a "dev" user with no redirect.
 * Blocked in production by middleware.js.
 *
 * No env vars required.
 */

export default {
  name: "bypass",

  getLoginUrl() {
    return null; // no redirect — authenticate inline
  },

  async authenticate() {
    return { netid: "dev", displayName: "Dev User" };
  },

  getLogoutUrl() {
    return null;
  },
};
