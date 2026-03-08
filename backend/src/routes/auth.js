import { Router } from "express";
import { validateTicket } from "../auth/cas.js";
import { generateToken, verifyToken } from "../auth/jwt.js";
import pool from "../db/pool.js";

const router = Router();

const CAS_BASE_URL = process.env.CAS_BASE_URL || "https://login.umt.edu/cas";
const CAS_SERVICE_URL = process.env.CAS_SERVICE_URL || "https://portal.example.edu/aif/api/auth/callback";
const CAS_LOGOUT_URL = process.env.CAS_LOGOUT_URL || "https://login.umt.edu/idp/profile/cas/logout";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://portal.example.edu/aif/";
const AUTH_BYPASS = process.env.AUTH_BYPASS === "true";
const ADMIN_NETIDS = (process.env.ADMIN_NETIDS || "").split(",").map(s => s.trim()).filter(Boolean);
const COOKIE_NAME = "aif_token";
const BASE_PATH = process.env.BASE_PATH || "/aif";

async function upsertUser(netid, displayName) {
  const { rows: [{ count }] } = await pool.query("SELECT COUNT(*) FROM users");
  const isFirstUser = parseInt(count) === 0;
  const isAdminNetid = ADMIN_NETIDS.includes(netid);
  const role = (isFirstUser || isAdminNetid) ? "admin" : "builder";

  const { rows: [user] } = await pool.query(
    `INSERT INTO users (netid, display_name, role, last_login)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (netid) DO UPDATE SET
       display_name = COALESCE(NULLIF($2, ''), users.display_name),
       last_login = NOW()
     RETURNING *`,
    [netid, displayName || null, role]
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

    console.log(`Auth success: ${user.netid} (${user.role})`);

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true, secure: true, sameSite: "lax",
      path: BASE_PATH, maxAge: 86400 * 1000,
    });
    res.redirect(FRONTEND_URL);
  } catch (err) {
    console.error("CAS callback error:", err);
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

export default router;
