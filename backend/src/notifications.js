import nodemailer from "nodemailer";
import pool from "./db/pool.js";
import { SMTP_HOST, SMTP_PORT, SMTP_FROM, FRONTEND_URL, INSTITUTION_NAME } from "./config.js";
import log from "./logger.js";

const AUTH_BYPASS = process.env.AUTH_BYPASS === "true";

const transporter = SMTP_HOST
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: false,
      tls: { rejectUnauthorized: !AUTH_BYPASS },
    })
  : null;

/**
 * Verify SMTP connectivity. Called during server preflight.
 * Returns true if SMTP is configured and reachable, false otherwise.
 */
export async function verifySmtp() {
  if (!transporter) return { configured: false };
  try {
    await transporter.verify();
    return { configured: true, reachable: true };
  } catch (err) {
    return { configured: true, reachable: false, error: err.message };
  }
}

/**
 * Create an in-app notification and optionally send email.
 * @param {Object} opts
 * @param {number} opts.userId - recipient user ID
 * @param {string} opts.toolId - related tool UUID (optional)
 * @param {string} opts.type - notification type
 * @param {string} opts.title - notification title
 * @param {string} opts.body - notification body text
 * @param {string} [opts.link] - relative hash link (e.g. "#/detail/uuid")
 */
export async function notify({ userId, toolId, type, title, body, link }) {
  try {
    // Create in-app notification
    await pool.query(
      `INSERT INTO notifications (user_id, tool_id, type, title, body)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, toolId || null, type, title, body || null]
    );

    // Check user preferences + email
    const { rows: [user] } = await pool.query(
      "SELECT email, notify_email FROM users WHERE id = $1",
      [userId]
    );

    if (user?.notify_email && user?.email) {
      const fullLink = link ? `${FRONTEND_URL}${link}` : FRONTEND_URL;
      sendEmail(user.email, title, body || title, fullLink).catch(err =>
        log.error("Email notification failed", { userId, error: err.message })
      );
      // Mark email_sent
      await pool.query(
        `UPDATE notifications SET email_sent = true
         WHERE user_id = $1 AND type = $2 AND tool_id IS NOT DISTINCT FROM $3
         ORDER BY created_at DESC LIMIT 1`,
        [userId, type, toolId || null]
      ).catch(() => {});
    }
  } catch (err) {
    log.error("Notification failed", { userId, type, error: err.message });
  }
}

/**
 * Notify all users with a given role.
 */
export async function notifyRole({ role, toolId, type, title, body, link }) {
  try {
    const { rows: users } = await pool.query(
      "SELECT id FROM users WHERE role = $1 AND is_active = true",
      [role]
    );
    await Promise.all(users.map(u =>
      notify({ userId: u.id, toolId, type, title, body, link })
    ));
  } catch (err) {
    log.error("Role notification failed", { role, type, error: err.message });
  }
}

/**
 * Send an email via SMTP.
 */
async function sendEmail(to, subject, text, link) {
  if (!transporter) return;
  const html = `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: #1A6B4B; padding: 16px 24px; border-radius: 8px 8px 0 0;">
        <h2 style="color: #fff; margin: 0; font-size: 16px;">AIF Portal Notification</h2>
      </div>
      <div style="padding: 24px; border: 1px solid #e5e5e5; border-top: none; border-radius: 0 0 8px 8px;">
        <h3 style="margin: 0 0 8px; font-size: 15px; color: #1a1a1a;">${escapeHtml(subject)}</h3>
        <p style="margin: 0 0 16px; font-size: 14px; color: #555; line-height: 1.5;">${escapeHtml(text)}</p>
        ${link ? `<a href="${escapeHtml(link)}" style="display: inline-block; padding: 10px 20px; background: #1A6B4B; color: #fff; text-decoration: none; border-radius: 6px; font-size: 13px; font-weight: 600;">View in Portal</a>` : ""}
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;" />
        <p style="margin: 0; font-size: 11px; color: #999;">${escapeHtml(INSTITUTION_NAME)} &middot; AI-Built Tool Code Intake Portal</p>
      </div>
    </div>`;

  await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject: `[AIF] ${subject}`,
    text: `${text}\n\n${link || FRONTEND_URL}`,
    html,
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
