import { useEffect, useState } from "react";
import { C } from "../constants.js";
import { Btn, ErrorBanner, Skeleton, relativeTime } from "./primitives.jsx";
import { getUsers, updateUserRole, toggleUserActive } from "../api.js";
import { useAuth } from "../hooks/useAuth.jsx";
import { useToast } from "./Toast.jsx";
import Breadcrumb from "./Breadcrumb.jsx";

const ROLES = ["builder", "reviewer", "admin"];
const ROLE_COLORS = { builder: C.textMid, reviewer: C.warning, admin: C.accent };

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const { toast, confirm } = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { load(); }, []);

  function load() {
    setLoading(true);
    getUsers()
      .then(d => setUsers(d.users || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }

  async function handleRoleChange(userId, newRole, netid) {
    const yes = await confirm({
      title: "Change user role?",
      message: `Change ${netid} to ${newRole}? Their permissions will update on next page load.`,
      confirmLabel: "Change Role",
    });
    if (!yes) return;
    try {
      await updateUserRole(userId, newRole);
      toast.success(`${netid} is now ${newRole}`);
      load();
    } catch (err) { toast.error(err.message); }
  }

  async function handleToggleActive(userId, currentActive, netid) {
    const action = currentActive ? "deactivate" : "activate";
    const yes = await confirm({
      title: `${currentActive ? "Deactivate" : "Activate"} user?`,
      message: `${action.charAt(0).toUpperCase() + action.slice(1)} ${netid}?`,
      confirmLabel: action.charAt(0).toUpperCase() + action.slice(1),
      destructive: currentActive,
    });
    if (!yes) return;
    try {
      await toggleUserActive(userId, !currentActive);
      toast.success(`${netid} ${action}d`);
      load();
    } catch (err) { toast.error(err.message); }
  }

  if (loading) return <div style={{ padding: 20 }}><Skeleton height={300} /></div>;
  if (error) return <div style={{ padding: 20 }}><ErrorBanner message={error} /></div>;

  return (
    <div>
      <Breadcrumb items={[{ label: "Admin", path: "/admin" }, { label: "Users" }]} />
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>User Management</h3>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textMid }}>{users.length} users</p>
      </div>

      <div style={{ borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
        <div className="registry-table-header" style={{ gridTemplateColumns: "1fr 1fr 120px 120px 80px 80px" }}>
          <span>Name</span><span>NetID</span><span>Role</span><span>Last Login</span><span>Tools</span><span>Active</span>
        </div>
        {users.map((u, i) => {
          const isSelf = currentUser?.userId === u.id;
          return (
            <div key={u.id} className="registry-table-row"
              style={{ background: i % 2 === 0 ? "transparent" : C.surface, gridTemplateColumns: "1fr 1fr 120px 120px 80px 80px" }}>
              <span style={{ fontWeight: 600 }}>{u.display_name || "—"}</span>
              <span className="mono" style={{ fontSize: 12, color: C.textMid }}>{u.netid}</span>
              <span>
                <select value={u.role} aria-label={`Role for ${u.netid}`}
                  onChange={e => handleRoleChange(u.id, e.target.value, u.netid)}
                  disabled={isSelf}
                  style={{ padding: "3px 6px", borderRadius: 4, border: `1px solid ${C.border}`,
                    background: C.surface, color: C.text, fontSize: 12,
                    fontFamily: "'DM Sans', sans-serif", cursor: isSelf ? "not-allowed" : "pointer" }}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </span>
              <span style={{ fontSize: 12, color: C.textMid }}>
                {u.last_login ? relativeTime(u.last_login) : "Never"}
              </span>
              <span className="mono" style={{ fontSize: 12, textAlign: "center" }}>{u.tool_count}</span>
              <span style={{ textAlign: "center" }}>
                <button type="button" aria-label={`${u.is_active ? "Deactivate" : "Activate"} ${u.netid}`}
                  onClick={() => !isSelf && handleToggleActive(u.id, u.is_active, u.netid)}
                  disabled={isSelf}
                  style={{ width: 36, height: 20, borderRadius: 10, border: "none", cursor: isSelf ? "not-allowed" : "pointer",
                    background: u.is_active ? C.accent : C.border, position: "relative", transition: "background .2s" }}>
                  <span style={{ position: "absolute", top: 2, left: u.is_active ? 18 : 2,
                    width: 16, height: 16, borderRadius: "50%", background: "#fff",
                    transition: "left .2s", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }} />
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
