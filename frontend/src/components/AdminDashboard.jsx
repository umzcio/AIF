import { useEffect, useState } from "react";
import { C, TRACK_COLORS, STATUS_META } from "../constants.js";
import { Btn, ErrorBanner, Skeleton, TrackBadge, relativeTime } from "./primitives.jsx";
import { getAdminDashboard, getAuditLog, getUsers, updateUserRole, toggleUserActive } from "../api.js";
import { navigate } from "../hooks/useHashRouter.js";
import { useAuth } from "../hooks/useAuth.jsx";
import { useToast } from "./Toast.jsx";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "users", label: "Users" },
  { id: "audit", label: "Audit Log" },
];

export default function AdminDashboard() {
  const [tab, setTab] = useState("overview");

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Admin Dashboard</h3>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textMid }}>System overview and management</p>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 2, marginBottom: 24, borderBottom: `1px solid ${C.border}` }}>
        {TABS.map(t => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
              background: "transparent", color: tab === t.id ? C.accent : C.textMid,
              borderBottom: `2px solid ${tab === t.id ? C.accent : "transparent"}`,
              fontFamily: "'DM Sans', sans-serif", transition: "color .15s, border-color .15s",
              marginBottom: -1 }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "users" && <UsersTab />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}

/* ── Overview Tab ── */

function OverviewTab() {
  const [stats, setStats] = useState(null);
  const [recentAudit, setRecentAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([getAdminDashboard(), getAuditLog({ limit: 20 })])
      .then(([dashData, auditData]) => { setStats(dashData); setRecentAudit(auditData.entries || []); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Skeleton height={400} />;
  if (error) return <ErrorBanner message={error} />;

  return (
    <>
      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        <SummaryCard label="Total Tools" value={stats.totalTools} />
        <SummaryCard label="Pending Reviews" value={stats.pendingReviews} accent={stats.pendingReviews > 0 ? C.warning : null} />
        <SummaryCard label="Pipeline Runs (30d)" value={stats.recentPipelineRuns} />
        <SummaryCard label="Active Users" value={`${stats.activeUsers} / ${stats.totalUsers}`} />
      </div>

      {/* Tools by Track / Status */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        <section className="section-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Tools by Track</div>
          <div style={{ display: "flex", gap: 8 }}>
            {[1,2,3,4].map(t => (
              <div key={t} style={{ flex: 1, textAlign: "center", padding: 12, borderRadius: 8,
                background: `${TRACK_COLORS[t]}10`, border: `1px solid ${TRACK_COLORS[t]}30` }}>
                <div className="mono" style={{ fontSize: 24, fontWeight: 700, color: TRACK_COLORS[t] }}>
                  {stats.byTrack[t] || 0}
                </div>
                <div style={{ fontSize: 11, color: C.textMid, marginTop: 2 }}>Track {t}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="section-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Tools by Status</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {Object.entries(stats.byStatus).map(([status, count]) => {
              const meta = STATUS_META[status] || {};
              return (
                <span key={status} style={{ display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                  background: meta.bg || C.surface, color: meta.color || C.textMid }}>
                  {meta.label || status}: {count}
                </span>
              );
            })}
          </div>
        </section>
      </div>

      {/* Recent activity */}
      <section className="section-card">
        <div className="card-header">
          <div><h2>Recent Activity</h2></div>
        </div>
        {recentAudit.length === 0 ? (
          <div style={{ padding: 16, fontSize: 13, color: C.textDim }}>No activity yet.</div>
        ) : (
          <div className="data-list">
            {recentAudit.map(entry => (
              <div key={entry.id} className="data-row" style={{ padding: "8px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="mono" style={{ fontSize: 11, color: C.textDim, minWidth: 120 }}>
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.accent }}>{entry.actor_netid}</span>
                  <span style={{ fontSize: 12, color: C.textMid }}>{formatAction(entry.action)}</span>
                  <span style={{ fontSize: 12, color: C.textDim }}>{entry.entity_type}/{entry.entity_id?.slice(0, 8)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/* ── Users Tab ── */

const ROLES = ["builder", "reviewer", "admin"];

function UsersTab() {
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

  if (loading) return <Skeleton height={300} />;
  if (error) return <ErrorBanner message={error} />;

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: C.textMid }}>{users.length} users</span>
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
    </>
  );
}

/* ── Audit Log Tab ── */

const PAGE_SIZE = 50;

function AuditTab() {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [actorFilter, setActorFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [entityTypeFilter, setEntityTypeFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => { load(); }, [page]);

  function load() {
    setLoading(true);
    const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
    if (actorFilter) params.actor = actorFilter;
    if (actionFilter) params.action = actionFilter;
    if (entityTypeFilter) params.entityType = entityTypeFilter;
    if (fromDate) params.from = fromDate;
    if (toDate) params.to = toDate;

    getAuditLog(params)
      .then(d => { setEntries(d.entries || []); setTotal(d.total || 0); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }

  function applyFilters() { setPage(0); load(); }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: C.textMid }}>{total} entries</span>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <FilterInput label="Actor" value={actorFilter} onChange={setActorFilter} placeholder="netid..." />
        <FilterInput label="Action" value={actionFilter} onChange={setActionFilter} placeholder="e.g. review_approved" />
        <FilterInput label="Entity Type" value={entityTypeFilter} onChange={setEntityTypeFilter} placeholder="tool, user..." />
        <FilterInput label="From" value={fromDate} onChange={setFromDate} type="date" />
        <FilterInput label="To" value={toDate} onChange={setToDate} type="date" />
        <Btn size="sm" onClick={applyFilters}>Filter</Btn>
      </div>

      {error && <ErrorBanner message={error} />}

      {loading ? <Skeleton height={300} /> : (
        <>
          <div style={{ borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
            <div className="registry-table-header" style={{ gridTemplateColumns: "160px 100px 140px 100px 1fr" }}>
              <span>Timestamp</span><span>Actor</span><span>Action</span><span>Entity</span><span>Details</span>
            </div>
            {entries.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", fontSize: 13, color: C.textDim }}>No entries found.</div>
            ) : entries.map((entry, i) => (
              <div key={entry.id} className="registry-table-row"
                style={{ background: i % 2 === 0 ? "transparent" : C.surface,
                  gridTemplateColumns: "160px 100px 140px 100px 1fr", cursor: "default" }}>
                <span className="mono" style={{ fontSize: 11, color: C.textDim }}>
                  {new Date(entry.created_at).toLocaleString()}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.accent }}>{entry.actor_netid}</span>
                <span style={{ fontSize: 12, color: C.textMid }}>{entry.action.replace(/_/g, " ")}</span>
                <span style={{ fontSize: 11, color: C.textDim }}>
                  {entry.entity_type}/{entry.entity_id?.slice(0, 8)}
                </span>
                <span style={{ fontSize: 11, color: C.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {entry.details ? JSON.stringify(entry.details) : ""}
                </span>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 16 }}>
              <Btn size="sm" variant="ghost" onClick={() => setPage(p => p - 1)} disabled={page === 0}>Prev</Btn>
              <span style={{ fontSize: 12, color: C.textMid }}>Page {page + 1} of {totalPages}</span>
              <Btn size="sm" variant="ghost" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>Next</Btn>
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ── Shared helpers ── */

function SummaryCard({ label, value, accent }) {
  return (
    <div style={{ padding: 16, borderRadius: 10, background: C.surface, border: `1px solid ${C.border}`, textAlign: "center" }}>
      <div style={{ fontSize: 11, color: C.textMid, marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: accent || C.text }}>{value}</div>
    </div>
  );
}

function FilterInput({ label, value, onChange, placeholder, type = "text" }) {
  const id = `audit-filter-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <label htmlFor={id} style={{ fontSize: 10, fontWeight: 600, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</label>
      <input id={id} type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ padding: "5px 8px", borderRadius: 6, border: `1px solid ${C.border}`,
          background: C.surface, color: C.text, fontSize: 12, fontFamily: "'DM Sans', sans-serif",
          width: type === "date" ? 130 : 120 }} />
    </div>
  );
}

function formatAction(action) {
  return action.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
