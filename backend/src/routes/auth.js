import { Router } from "express";
import { validateTicket } from "../auth/cas.js";
import { generateToken, verifyToken } from "../auth/jwt.js";
import pool from "../db/pool.js";
import { CAS_BASE_URL, CAS_SERVICE_URL, CAS_LOGOUT_URL, FRONTEND_URL, AUTH_BYPASS, ADMIN_NETIDS, JWT_COOKIE_NAME, BASE_PATH, INSTITUTION_DOMAIN } from "../config.js";
import log from "../logger.js";

const router = Router();

const COOKIE_NAME = JWT_COOKIE_NAME;

async function upsertUser(netid, displayName) {
  const { rows: [{ count }] } = await pool.query("SELECT COUNT(*) FROM users");
  const isFirstUser = parseInt(count) === 0;
  const isAdminNetid = ADMIN_NETIDS.includes(netid);
  const role = (isFirstUser || isAdminNetid) ? "admin" : "builder";

  const defaultEmail = `${netid}@${INSTITUTION_DOMAIN}`;
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

router.get("/login", (req, res) => {
  if (AUTH_BYPASS) {
    // Dev bypass: generate token for dummy user
    (async () => {
      const user = await upsertUser("dev", "Dev User");
      const token = await generateToken(user);
      res.cookie(COOKIE_NAME, token, {
        httpOnly: true, secure: true, sameSite: "lax",
        path: BASE_PATH, maxAge: 86400 * 1000,
      });
      res.redirect(FRONTEND_URL);
    })().catch(err => res.status(500).json({ error: err.message }));
    return;
  }
  const loginUrl = `${CAS_BASE_URL}/login?service=${encodeURIComponent(CAS_SERVICE_URL)}`;
  res.redirect(loginUrl);
});

router.get("/callback", async (req, res) => {
  const { ticket } = req.query;
  if (!ticket) return res.redirect(`${FRONTEND_URL}?error=no_ticket`);

  try {
    const casUser = await validateTicket(ticket, CAS_SERVICE_URL);
    if (!casUser) return res.redirect(`${FRONTEND_URL}?error=validation_failed`);

    const user = await upsertUser(casUser.netid, casUser.displayName);
    const token = await generateToken(user);

    log.info("Auth success", { netid: user.netid, role: user.role });

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true, secure: true, sameSite: "lax",
      path: BASE_PATH, maxAge: 86400 * 1000,
    });
    res.redirect(FRONTEND_URL);
  } catch (err) {
    log.error("CAS callback error", { error: err.message });
    res.redirect(`${FRONTEND_URL}?error=auth_error`);
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: BASE_PATH });
  res.json({ success: true, casLogoutUrl: CAS_LOGOUT_URL });
});

router.get("/status", async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ authenticated: false });

  try {
    const payload = await verifyToken(token);
    res.json({ authenticated: true, user: payload });
  } catch {
    res.status(401).json({ authenticated: false });
  }
});

// Refresh — re-reads user from DB and issues fresh JWT so role changes take effect
router.get("/refresh", async (req, res) => {
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
    res.cookie(COOKIE_NAME, freshToken, {
      httpOnly: true, secure: true, sameSite: "lax",
      path: BASE_PATH, maxAge: 86400 * 1000,
    });
    res.json({
      authenticated: true,
      user: { netid: user.netid, role: user.role, userId: user.id, displayName: user.display_name },
    });
  } catch {
    res.status(401).json({ authenticated: false });
  }
});

export default router;
