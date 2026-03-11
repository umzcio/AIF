import { verifyToken } from "./jwt.js";
import pool from "../db/pool.js";
import log from "../logger.js";

const AUTH_BYPASS_RAW = process.env.AUTH_BYPASS === "true";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// Block AUTH_BYPASS in production — log error but don't crash
if (AUTH_BYPASS_RAW && IS_PRODUCTION) {
  log.error("AUTH_BYPASS cannot be enabled in production — ignoring");
}
const AUTH_BYPASS = AUTH_BYPASS_RAW && !IS_PRODUCTION;

const COOKIE_NAME = "aif_token";

// Routes that require authentication (write operations)
const PROTECTED_PREFIXES = ["/intake", "/pipeline", "/review", "/admin", "/reports"];
const PROTECTED_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

function isProtectedRoute(req) {
  // Auth routes are never protected
  if (req.path.startsWith("/auth/")) return false;

  // Write operations on any route require auth
  if (PROTECTED_METHODS.includes(req.method)) return true;

  // Read operations on intake/pipeline require auth
  if (PROTECTED_PREFIXES.some(p => req.path.startsWith(p))) return true;

  return false;
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Insufficient permissions" });
    next();
  };
}

export function requireOwnerOrRole(...roles) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    const toolId = req.params.id || req.params.toolId;
    if (!toolId) return res.status(400).json({ error: "Missing tool ID" });

    const { rows: [tool] } = await pool.query("SELECT * FROM tools WHERE id = $1", [toolId]);
    if (!tool) return res.status(404).json({ error: "Tool not found" });

    if (tool.owner_id === req.user.userId || roles.includes(req.user.role)) {
      req.tool = tool;
      return next();
    }
    return res.status(403).json({ error: "Insufficient permissions" });
  };
}

export default async function authMiddleware(req, res, next) {
  // Auth routes always pass through
  if (req.path.startsWith("/auth/")) return next();

  if (AUTH_BYPASS) {
    if (!authMiddleware._devUser) {
      const { rows: [user] } = await pool.query(
        `INSERT INTO users (netid, display_name, role, last_login)
         VALUES ('dev', 'Dev User', 'admin', NOW())
         ON CONFLICT (netid) DO UPDATE SET last_login = NOW()
         RETURNING *`
      );
      authMiddleware._devUser = { netid: user.netid, role: user.role, userId: user.id, displayName: user.display_name };
    }
    req.user = { ...authMiddleware._devUser, ip: req.ip };
    return next();
  }

  // Try to populate req.user from cookie (but don't block if missing)
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      const tokenData = await verifyToken(token);
      req.user = { ...tokenData, ip: req.ip };
    } catch {
      // Invalid token — clear it but don't block public routes
      res.clearCookie(COOKIE_NAME, { path: process.env.BASE_PATH || "/aif" });
    }
  }

  // If this route requires auth and we don't have a user, reject
  if (isProtectedRoute(req) && !req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  next();
}
