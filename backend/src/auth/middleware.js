import { verifyToken } from "./jwt.js";

const AUTH_BYPASS = process.env.AUTH_BYPASS === "true";
const COOKIE_NAME = "aif_token";

// Routes that require authentication (write operations)
const PROTECTED_PREFIXES = ["/intake", "/pipeline"];
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

export default async function authMiddleware(req, res, next) {
  // Auth routes always pass through
  if (req.path.startsWith("/auth/")) return next();

  if (AUTH_BYPASS) {
    req.user = { netid: "dev", role: "admin", userId: 0, displayName: "Dev User" };
    return next();
  }

  // Try to populate req.user from cookie (but don't block if missing)
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      req.user = await verifyToken(token);
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
