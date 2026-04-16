/**
 * CAS Auth Provider
 *
 * Central Authentication Service — standard protocol at most universities.
 * One redirect to the CAS server, one ticket validation on callback.
 *
 * Required env:
 *   CAS_BASE_URL     — e.g. https://login.example.edu/cas
 *   CAS_SERVICE_URL  — your callback URL, e.g. https://your-domain.edu/aif/api/auth/callback
 *
 * Optional env:
 *   CAS_LOGOUT_URL   — defaults to {CAS_BASE_URL}/../idp/profile/cas/logout
 */

import { CAS_BASE_URL, CAS_SERVICE_URL, CAS_LOGOUT_URL } from "../../config.js";

if (!CAS_BASE_URL) {
  throw new Error("AUTH_PROVIDER=cas requires CAS_BASE_URL to be set");
}
if (!CAS_SERVICE_URL) {
  throw new Error("AUTH_PROVIDER=cas requires CAS_SERVICE_URL to be set");
}

const CAS_VALIDATE_URL = `${CAS_BASE_URL}/serviceValidate`;

function parseCASXML(xml) {
  // CAS 2.0 success response
  const userMatch = xml.match(/<cas:user>([^<]+)<\/cas:user>/);
  if (!userMatch) {
    // CAS 1.0 fallback
    const lines = xml.trim().split("\n");
    if (lines[0] === "yes" && lines[1]) {
      return { netid: lines[1].trim(), displayName: null };
    }
    return null;
  }

  const netid = userMatch[1].trim();
  const nameMatch = xml.match(/<cas:commonName>([^<]+)<\/cas:commonName>/) ||
                    xml.match(/<cas:displayName>([^<]+)<\/cas:displayName>/);
  const displayName = nameMatch ? nameMatch[1].trim() : null;

  return { netid, displayName };
}

export default {
  name: "cas",

  getLoginUrl() {
    return `${CAS_BASE_URL}/login?service=${encodeURIComponent(CAS_SERVICE_URL)}`;
  },

  async authenticate(req) {
    const ticket = req.query?.ticket;
    if (!ticket) return null;

    const url = `${CAS_VALIDATE_URL}?ticket=${encodeURIComponent(ticket)}&service=${encodeURIComponent(CAS_SERVICE_URL)}`;
    const resp = await fetch(url);
    const xml = await resp.text();
    return parseCASXML(xml);
  },

  getLogoutUrl() {
    return CAS_LOGOUT_URL || null;
  },
};
