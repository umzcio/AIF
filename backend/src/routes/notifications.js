import { Router } from "express";
import pool from "../db/pool.js";
import { validate, notificationReadSchema, notificationPrefsSchema, emailUpdateSchema } from "../validation.js";

const router = Router();

// Get notifications for current user
router.get("/", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });

  const limit = Math.min(parseInt(req.query.limit) || 30, 100);
  const offset = parseInt(req.query.offset) || 0;
  const unreadOnly = req.query.unread === "true";

  const whereClause = unreadOnly
    ? "WHERE n.user_id = $1 AND n.read = false"
    : "WHERE n.user_id = $1";

  const { rows: notifications } = await pool.query(
    `SELECT n.*, t.name as tool_name
     FROM notifications n
     LEFT JOIN tools t ON n.tool_id = t.id
     ${whereClause}
     ORDER BY n.created_at DESC
     LIMIT $2 OFFSET $3`,
    [req.user.userId, limit, offset]
  );

  const { rows: [{ count }] } = await pool.query(
    `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read = false`,
    [req.user.userId]
  );

  res.json({ notifications, unread_count: parseInt(count) });
});

// Mark notification(s) as read
router.patch("/read", validate(notificationReadSchema), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });

  const { ids } = req.validated;

  if (ids === "all") {
    await pool.query(
      "UPDATE notifications SET read = true WHERE user_id = $1 AND read = false",
      [req.user.userId]
    );
  } else {
    await pool.query(
      "UPDATE notifications SET read = true WHERE user_id = $1 AND id = ANY($2)",
      [req.user.userId, ids]
    );
  }

  // Return updated count
  const { rows: [{ count }] } = await pool.query(
    "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read = false",
    [req.user.userId]
  );

  res.json({ success: true, unread_count: parseInt(count) });
});

// Update notification preferences
router.patch("/preferences", validate(notificationPrefsSchema), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });

  const { notify_email, notify_in_app } = req.validated;

  const updates = [];
  const values = [];
  let idx = 1;

  if (typeof notify_email === "boolean") {
    updates.push(`notify_email = $${idx++}`);
    values.push(notify_email);
  }
  if (typeof notify_in_app === "boolean") {
    updates.push(`notify_in_app = $${idx++}`);
    values.push(notify_in_app);
  }

  values.push(req.user.userId);
  await pool.query(
    `UPDATE users SET ${updates.join(", ")} WHERE id = $${idx}`,
    values
  );

  res.json({ success: true });
});

// Get notification preferences
router.get("/preferences", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });

  const { rows: [user] } = await pool.query(
    "SELECT email, notify_email, notify_in_app FROM users WHERE id = $1",
    [req.user.userId]
  );

  res.json({
    email: user?.email || null,
    notify_email: user?.notify_email ?? true,
    notify_in_app: user?.notify_in_app ?? true,
  });
});

// Update email address
router.patch("/email", validate(emailUpdateSchema), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });

  const { email } = req.validated;

  await pool.query(
    "UPDATE users SET email = $1 WHERE id = $2",
    [email || null, req.user.userId]
  );

  res.json({ success: true });
});

export default router;
