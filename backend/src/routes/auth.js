import { Router } from "express";
import provider from "../auth/providers/index.js";
import { generateToken, verifyToken } from "../auth/jwt.js";
import pool from "../db/pool.js";
import { FRONTEND_URL, ADMIN_NETIDS, JWT_COOKIE_NAME, BASE_PATH, INSTITUTION_DOMAIN } from "../config.js";
import log from "../logger.js";
import { wrap } from "../middleware/async-handler.js";

const router = Router();

const COOKIE_NAME = JWT_COOKIE_NAME;
const COOKIE_OPTS = {
  httpOnly: true, secure: true, sameSite: "lax",
  path: BASE_PATH, maxAge: 86400 * 1000,
};

async function upsertUser(netid, displayName) {
  const { rows: [{ count }] } = await pool.query("SELECT COUNT(*) FROM users");
  const isFirstUser = parseInt(count) === 0;
  const isAdminNetid = ADMIN_NETIDS.includes(netid);
  const role = (isFirstUser || isAdminNetid) ? "admin" : "builder";

  const defaultEmail = INSTITUTION_DOMAIN ? `${netid}@${INSTITUTION_DOMAIN}` : null;
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (netid, display_name, role, email, last_login)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (netid) DO UPDATE SET
       display_name = COALESCE(NULLIF($2, ''), users.display_name),
       email = COALESCE(users.email, $4),
       last_login = NOW()
     RETURNING *`,
    [netid, displayName || null, role, defaultEmail]
  );
  return user;
}

async function loginAndRedirect(identity, res) {
  const user = await upsertUser(identity.netid, identity.displayName);
  const token = await generateToken(user);
  log.info("Auth success", { netid: user.netid, role: user.role, provider: provider.name });
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
  res.redirect(FRONTEND_URL || BASE_PATH);
}

// --- Routes ---

router.get("/login", wrap(async (req, res) => {
  try {
    const loginUrl = provider.getLoginUrl();

    if (loginUrl) {
      // Redirect-based provider (CAS, OIDC, SAML) — send user to IdP
      return res.redirect(loginUrl);
    }

    // Direct-auth provider (bypass, header) — authenticate inline
    const identity = await provider.authenticate(req);
    if (!identity) {
      return res.redirect(`${FRONTEND_URL || BASE_PATH}?error=auth_failed`);
    }
    await loginAndRedirect(identity, res);
  } catch (err) {
    log.error("Login error", { error: err.message, provider: provider.name });
    res.redirect(`${FRONTEND_URL || BASE_PATH}?error=auth_error`);
  }
}));

router.get("/callback", wrap(async (req, res) => {
  try {
    const identity = await provider.authenticate(req);
    if (!identity) {
      return res.redirect(`${FRONTEND_URL || BASE_PATH}?error=validation_failed`);
    }
    await loginAndRedirect(identity, res);
  } catch (err) {
    log.error("Auth callback error", { error: err.message, provider: provider.name });
    res.redirect(`${FRONTEND_URL || BASE_PATH}?error=auth_error`);
  }
}));

router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: BASE_PATH });
  const logoutUrl = provider.getLogoutUrl();
  res.json({ success: true, ...(logoutUrl ? { casLogoutUrl: logoutUrl } : {}) });
});

router.get("/status", wrap(async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ authenticated: false });

  try {
    const payload = await verifyToken(token);
    res.json({ authenticated: true, user: payload });
  } catch {
    res.status(401).json({ authenticated: false });
  }
}));

// Refresh — re-reads user from DB and issues fresh JWT so role changes take effect
router.get("/refresh", wrap(async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ authenticated: false });

  try {
    const payload = await verifyToken(token);
    const { rows: [user] } = await pool.query("SELECT * FROM users WHERE id = $1", [payload.userId]);
    if (!user || !user.is_active) {
      res.clearCookie(COOKIE_NAME, { path: BASE_PATH });
      return res.status(401).json({ authenticated: false });
    }

    const freshToken = await generateToken(user);
    res.cookie(COOKIE_NAME, freshToken, COOKIE_OPTS);
    res.json({
      authenticated: true,
      user: { netid: user.netid, role: user.role, userId: user.id, displayName: user.display_name },
    });
  } catch {
    res.status(401).json({ authenticated: false });
  }
}));

export default router;
