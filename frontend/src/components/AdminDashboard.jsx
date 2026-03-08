import { useEffect, useState } from "react";
import { C, TRACK_COLORS, TRACK_LABELS, STATUS_META } from "../constants.js";
import { Btn, ErrorBanner, Skeleton, TrackBadge } from "./primitives.jsx";
import { getAdminDashboard, getAuditLog } from "../api.js";
import { navigate } from "../hooks/useHashRouter.js";

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [recentAudit, setRecentAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      getAdminDashboard(),
      getAuditLog({ limit: 20 }),
    ])
      .then(([dashData, auditData]) => {
        setStats(dashData);
        setRecentAudit(auditData.entries || []);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 20 }}><Skeleton height={400} /></div>;
  if (error) return <div style={{ padding: 20 }}><ErrorBanner message={error} /></div>;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Admin Dashboard</h3>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textMid }}>System overview and management</p>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        <SummaryCard label="Total Tools" value={stats.totalTools} />
        <SummaryCard label="Pending Reviews" value={stats.pendingReviews} accent={stats.pendingReviews > 0 ? C.warning : null} />
        <SummaryCard label="Pipeline Runs (30d)" value={stats.recentPipelineRuns} />
        <SummaryCard label="Active Users" value={`${stats.activeUsers} / ${stats.totalUsers}`} />
      </div>

      {/* Tools by Track */}
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

      {/* Quick links */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        <Btn size="sm" onClick={() => navigate("/admin/users")}>User Management</Btn>
        <Btn size="sm" variant="ghost" onClick={() => navigate("/admin/audit")}>Audit Log</Btn>
        <Btn size="sm" variant="ghost" onClick={() => navigate("/registry")}>Registry</Btn>
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
    </div>
  );
}

function SummaryCard({ label, value, accent }) {
  return (
    <div style={{ padding: 16, borderRadius: 10, background: C.surface, border: `1px solid ${C.border}`, textAlign: "center" }}>
      <div style={{ fontSize: 11, color: C.textMid, marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: accent || C.text }}>{value}</div>
    </div>
  );
}

function formatAction(action) {
  return action.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
