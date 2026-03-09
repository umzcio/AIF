/**
 * Unified application configuration.
 * All institution-specific values come from environment variables.
 */

// Auth
export const CAS_BASE_URL = process.env.CAS_BASE_URL || "https://login.umt.edu/cas";
export const CAS_SERVICE_URL = process.env.CAS_SERVICE_URL;
export const CAS_LOGOUT_URL = process.env.CAS_LOGOUT_URL || `${CAS_BASE_URL.replace("/cas", "")}/idp/profile/cas/logout`;
export const FRONTEND_URL = process.env.FRONTEND_URL;
export const AUTH_BYPASS = process.env.AUTH_BYPASS === "true";
export const ADMIN_NETIDS = (process.env.ADMIN_NETIDS || "").split(",").map(s => s.trim()).filter(Boolean);
export const BASE_PATH = process.env.BASE_PATH || "/aif";
export const JWT_COOKIE_NAME = "aif_token";

// Email
export const SMTP_HOST = process.env.SMTP_HOST || "";
export const SMTP_PORT = parseInt(process.env.SMTP_PORT || "25");
export const SMTP_FROM = process.env.SMTP_FROM || "";

// Institution identity (served to frontend via /api/config)
export const INSTITUTION_NAME = process.env.INSTITUTION_NAME || "University of Montana";
export const INSTITUTION_DOMAIN = process.env.INSTITUTION_DOMAIN || "umontana.edu";

// Pipeline
export const OUTPUT_DIR = process.env.OUTPUT_DIR || "/data/output";
export const CODEBASES_DIR = process.env.CODEBASES_DIR || "/data/codebases";
