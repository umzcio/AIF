/**
 * Auth Provider Loader
 *
 * Reads AUTH_PROVIDER env var and returns the matching provider module.
 * Each provider implements: { name, getLoginUrl(), authenticate(req), getLogoutUrl() }
 *
 * Supported providers:
 *   cas     — CAS SSO (requires CAS_BASE_URL, CAS_SERVICE_URL)
 *   oidc    — OpenID Connect / Entra ID (stub — requires implementation)
 *   saml    — SAML 2.0 (stub — requires implementation)
 *   header  — Reverse proxy auth (requires AUTH_HEADER_USER)
 *   bypass  — Dev mode, auto-authenticates as "dev" user
 */

import log from "../../logger.js";
import { AUTH_PROVIDER as PROVIDER_NAME } from "../../config.js";

let provider;

switch (PROVIDER_NAME) {
  case "cas":
    provider = (await import("./cas.js")).default;
    break;
  case "oidc":
    provider = (await import("./oidc.js")).default;
    break;
  case "saml":
    provider = (await import("./saml.js")).default;
    break;
  case "header":
    provider = (await import("./header.js")).default;
    break;
  case "bypass":
    provider = (await import("./bypass.js")).default;
    break;
  default:
    throw new Error(`Unknown AUTH_PROVIDER: "${PROVIDER_NAME}". Valid options: cas, oidc, saml, header, bypass`);
}

log.info("Auth provider loaded", { provider: provider.name });

export default provider;
