import { useState, useRef, useEffect, useCallback } from "react";
import { Bell, CheckCheck, Settings, X, Mail } from "lucide-react";
import { C } from "../constants.js";
import { getNotifications, markNotificationsRead, getNotificationPreferences, updateNotificationPreferences, updateEmail } from "../api.js";
import { navigate } from "../hooks/useHashRouter.js";

const POLL_INTERVAL = 30000; // 30s

function relativeTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const TYPE_ICONS = {
  pipeline_complete: "🔬",
  review_needed: "📋",
  review_approved: "✅",
  review_changes_requested: "🔄",
  track_override: "⚡",
  tool_activated: "🚀",
  comment: "💬",
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("notifications"); // "notifications" | "settings"
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [prefs, setPrefs] = useState(null);
  const [emailInput, setEmailInput] = useState("");
  const [saving, setSaving] = useState(false);
  const ref = useRef(null);
  const intervalRef = useRef(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await getNotifications({ limit: 20 });
      setNotifications(data.notifications);
      setUnreadCount(data.unread_count);
    } catch {}
  }, []);

  // Poll for new notifications
  useEffect(() => {
    fetchNotifications();
    intervalRef.current = setInterval(fetchNotifications, POLL_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Load prefs when settings tab opens
  useEffect(() => {
    if (tab === "settings" && open && !prefs) {
      getNotificationPreferences().then(p => {
        setPrefs(p);
        setEmailInput(p.email || "");
      }).catch(() => {});
    }
  }, [tab, open, prefs]);

  async function handleMarkAllRead() {
    try {
      const result = await markNotificationsRead("all");
      setUnreadCount(result.unread_count);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch {}
  }

  async function handleMarkRead(id) {
    try {
      const result = await markNotificationsRead([id]);
      setUnreadCount(result.unread_count);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    } catch {}
  }

  function handleNotifClick(notif) {
    if (!notif.read) handleMarkRead(notif.id);
    // Navigate using the stored link, falling back to tool detail
    if (notif.link) {
      navigate(notif.link.replace(/^#/, ""));
    } else if (notif.tool_id) {
      navigate(`/tool/${notif.tool_id}`);
    }
    setOpen(false);
  }

  async function handleSavePrefs() {
    setSaving(true);
    try {
      if (prefs) {
        await updateNotificationPreferences({
          notify_email: prefs.notify_email,
          notify_in_app: prefs.notify_in_app,
        });
      }
      if (emailInput !== (prefs?.email || "")) {
        await updateEmail(emailInput);
      }
      setPrefs(p => ({ ...p, email: emailInput }));
    } catch {}
    setSaving(false);
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setTab("notifications"); }}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        style={{
          position: "relative", width: 34, height: 34, borderRadius: "50%",
          border: "none", background: open ? C.surface : "transparent",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          transition: "background .15s",
        }}
      >
        <Bell size={17} color={C.textMid} />
        {unreadCount > 0 && (
          <span style={{
            position: "absolute", top: 3, right: 3,
            width: unreadCount > 9 ? 18 : 16, height: 16, borderRadius: 8,
            background: C.danger, color: "#fff", fontSize: 10, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            lineHeight: 1,
          }}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute", right: 0, top: "calc(100% + 6px)", width: 360,
          background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12,
          boxShadow: "0 12px 40px rgba(0,0,0,0.15)", zIndex: 200, overflow: "hidden",
          maxHeight: "70vh", display: "flex", flexDirection: "column",
        }}>
          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 16px", borderBottom: `1px solid ${C.border}`,
          }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setTab("notifications")}
                style={{
                  fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
                  border: "none", background: "transparent", cursor: "pointer",
                  color: tab === "notifications" ? C.accent : C.textMid,
                  borderBottom: tab === "notifications" ? `2px solid ${C.accent}` : "2px solid transparent",
                  paddingBottom: 2,
                }}>
                Notifications
              </button>
              <button type="button" onClick={() => setTab("settings")}
                style={{
                  fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
                  border: "none", background: "transparent", cursor: "pointer",
                  color: tab === "settings" ? C.accent : C.textMid,
                  borderBottom: tab === "settings" ? `2px solid ${C.accent}` : "2px solid transparent",
                  paddingBottom: 2,
                  display: "inline-flex", alignItems: "center", gap: 3,
                }}>
                <Settings size={12} />
                Settings
              </button>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {tab === "notifications" && unreadCount > 0 && (
                <button type="button" onClick={handleMarkAllRead}
                  aria-label="Mark all as read"
                  title="Mark all as read"
                  style={{
                    width: 28, height: 28, borderRadius: 6, border: "none",
                    background: "transparent", cursor: "pointer", display: "flex",
                    alignItems: "center", justifyContent: "center",
                  }}>
                  <CheckCheck size={15} color={C.accent} />
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)}
                aria-label="Close"
                style={{
                  width: 28, height: 28, borderRadius: 6, border: "none",
                  background: "transparent", cursor: "pointer", display: "flex",
                  alignItems: "center", justifyContent: "center",
                }}>
                <X size={15} color={C.textMid} />
              </button>
            </div>
          </div>

          {tab === "notifications" ? (
            <div style={{ overflowY: "auto", flex: 1 }}>
              {notifications.length === 0 ? (
                <div style={{ padding: 32, textAlign: "center", color: C.textDim, fontSize: 13 }}>
                  No notifications yet
                </div>
              ) : (
                notifications.map(n => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => handleNotifClick(n)}
                    style={{
                      width: "100%", display: "flex", gap: 10, padding: "10px 16px",
                      border: "none", borderBottom: `1px solid ${C.border}`,
                      background: n.read ? "transparent" : C.accentSoft,
                      cursor: "pointer", textAlign: "left",
                      fontFamily: "'DM Sans', sans-serif", transition: "background .1s",
                    }}
                    onMouseEnter={e => { if (n.read) e.currentTarget.style.background = C.surface; }}
                    onMouseLeave={e => { e.currentTarget.style.background = n.read ? "transparent" : C.accentSoft; }}
                  >
                    <span style={{ fontSize: 16, lineHeight: 1.3, flexShrink: 0 }}>
                      {TYPE_ICONS[n.type] || "📌"}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: n.read ? 400 : 600,
                        color: C.text, lineHeight: 1.3,
                        overflow: "hidden", textOverflow: "ellipsis",
                        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                      }}>
                        {n.title}
                      </div>
                      {n.body && (
                        <div style={{
                          fontSize: 12, color: C.textDim, marginTop: 2,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {n.body}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: C.textDim, marginTop: 3 }}>
                        {n.tool_name && <span>{n.tool_name} &middot; </span>}
                        {relativeTime(n.created_at)}
                      </div>
                    </div>
                    {!n.read && (
                      <span style={{
                        width: 8, height: 8, borderRadius: "50%", background: C.accent,
                        flexShrink: 0, marginTop: 4,
                      }} />
                    )}
                  </button>
                ))
              )}
            </div>
          ) : (
            /* Settings tab */
            <div style={{ padding: 16 }}>
              <div style={{ marginBottom: 16 }}>
                <label htmlFor="notification-email" style={{ fontSize: 12, fontWeight: 600, color: C.textMid, display: "block", marginBottom: 6 }}>
                  Email Address
                </label>
                <input
                  id="notification-email"
                  type="email"
                  autoComplete="email"
                  value={emailInput}
                  onChange={e => setEmailInput(e.target.value)}
                  placeholder="netid@umontana.edu"
                  style={{
                    width: "100%", padding: "8px 12px", borderRadius: 8,
                    border: `1px solid ${C.border}`, background: C.surface,
                    fontSize: 13, fontFamily: "'DM Sans', sans-serif", color: C.text,
                    boxSizing: "border-box",
                  }}
                />
                <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>
                  Auto-set from your NetID. Change if needed.
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                <label style={{
                  display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                  fontSize: 13, color: C.text,
                }}>
                  <input
                    type="checkbox"
                    checked={prefs?.notify_in_app ?? true}
                    onChange={e => setPrefs(p => ({ ...p, notify_in_app: e.target.checked }))}
                    style={{ accentColor: "#1A6B4B" }}
                  />
                  <Bell size={14} color={C.textMid} />
                  In-app notifications
                </label>
                <label style={{
                  display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                  fontSize: 13, color: C.text,
                }}>
                  <input
                    type="checkbox"
                    checked={prefs?.notify_email ?? false}
                    onChange={e => setPrefs(p => ({ ...p, notify_email: e.target.checked }))}
                    style={{ accentColor: "#1A6B4B" }}
                  />
                  <Mail size={14} color={C.textMid} />
                  Email notifications
                </label>
              </div>

              <button
                type="button"
                onClick={handleSavePrefs}
                disabled={saving}
                style={{
                  padding: "8px 20px", borderRadius: 8, border: "none",
                  background: C.accent, color: "#fff", cursor: saving ? "default" : "pointer",
                  fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? "Saving..." : "Save Preferences"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
