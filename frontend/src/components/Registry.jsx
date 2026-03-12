import { useEffect, useMemo, useState } from "react";
import { C, STATUS_META, TRACK_COLORS, TRACK_LABELS } from "../constants.js";
import { Btn, EmptyState, ErrorBanner, TrackBadge, Skeleton, relativeTime } from "./primitives.jsx";
import { getTools, deleteDraft } from "../api.js";
import { navigate } from "../hooks/useHashRouter.js";
import { useToast } from "./Toast.jsx";
import { useAuth } from "../hooks/useAuth.jsx";

const statusColors = { active: TRACK_COLORS[1], approved: TRACK_COLORS[1], in_progress: TRACK_COLORS[3], under_review: TRACK_COLORS[2], changes_requested: TRACK_COLORS[2], pending: TRACK_COLORS[2], suspended: TRACK_COLORS[4], draft: C.textDim };
const statusLabels = { active: "Active", approved: "Approved", in_progress: "In Progress", under_review: "In Review", changes_requested: "Changes Req.", pending: "Pending", suspended: "Suspended", draft: "Draft", retired: "Retired" };

export default function Registry() {
  const { user } = useAuth();
  const { toast, confirm } = useToast();
  const [filter, setFilter] = useState("all");
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getTools({})
      .then(data => { setTools(data.tools || []); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  const filtered = useMemo(() => {
    if (filter === "all") return tools;
    if (filter === "needs_review") return tools.filter(t => t.status === "under_review" || t.status === "changes_requested");
    return tools.filter(t => t.status === filter);
  }, [filter, tools]);

  const trackCounts = useMemo(() => {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    tools.forEach(t => { if (t.track) counts[t.track] = (counts[t.track] || 0) + 1; });
    return counts;
  }, [tools]);

  const activeCount = tools.filter(t => t.status === "active").length;
  const reviewCount = tools.filter(t => t.status === "under_review" || t.status === "changes_requested").length;
  const isReviewerOrAdmin = user && (user.role === "reviewer" || user.role === "admin");

  if (loading) return <div style={{ padding: 20 }}><Skeleton height={300} /></div>;
  if (error) return <div style={{ padding: 20 }}><ErrorBanner message={error} onRetry={() => setRefreshKey(v => v + 1)} /></div>;

  return (
    <div>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Tool Registry</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textMid }}>{tools.length} tools registered · {activeCount} active</p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[
            ["all", "All"],
            ...(isReviewerOrAdmin ? [["needs_review", `Needs Review (${reviewCount})`]] : []),
            ["active", "Active"],
            ["in_progress", "In Progress"],
            ["pending", "Pending"],
          ].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)}
              style={{ padding: "6px 14px", borderRadius: 6,
                border: `1px solid ${filter === v ? (v === "needs_review" ? C.warning : C.accent) : C.border}`,
                background: filter === v ? (v === "needs_review" ? "rgba(192,141,26,0.08)" : C.accentSoft) : "transparent",
                color: filter === v ? (v === "needs_review" ? C.warning : C.accent) : C.textMid,
                fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState heading="No tools found" body="Adjust filters or submit a new tool." action={<Btn onClick={() => navigate("/intake")}>Submit tool</Btn>} />
      ) : (
        <div style={{ borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr className="registry-table-header" style={{ display: "grid", gridTemplateColumns: "2fr 80px 1fr 1fr 100px 100px" }}>
                <th scope="col">Tool Name</th><th scope="col">Track</th><th scope="col">Owner</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, i) => (
                <tr key={item.id} className="registry-table-row" tabIndex={user ? 0 : undefined}
                  style={{ background: i % 2 === 0 ? "transparent" : C.surface, cursor: user ? "pointer" : "default" }}
                  onClick={user ? () => navigate(item.status === "in_progress" ? `/upload/${item.id}` : `/tool/${item.id}`) : undefined}
                  onKeyDown={user ? (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(item.status === "in_progress" ? `/upload/${item.id}` : `/tool/${item.id}`); }}) : undefined}
                  onMouseEnter={user ? (e => e.currentTarget.style.background = C.surfaceHover) : undefined}
                  onMouseLeave={user ? (e => e.currentTarget.style.background = i % 2 === 0 ? "transparent" : C.surface) : undefined}
                  onFocus={user ? (e => e.currentTarget.style.background = C.surfaceHover) : undefined}
                  onBlur={user ? (e => e.currentTarget.style.background = i % 2 === 0 ? "transparent" : C.surface) : undefined}>
                  <th scope="row" style={{ fontWeight: 600, textAlign: "left", padding: 0 }}>{item.name}</th>
                  <td>{item.track ? <TrackBadge track={item.track} /> : <span style={{ color: C.textDim }}>—</span>}</td>
                  <td style={{ color: C.textMid }}>{item.owner_name || item.owner_netid || "—"}</td>
                  <td style={{ color: C.textMid }}>{item.artifact_type || "—"}</td>
                  <td style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: statusColors[item.status] || C.textDim,
                      ...(item.status === "in_progress" ? { animation: "pulse 1.5s infinite" } : {}) }} />
                    <span style={{ fontSize: 12, color: statusColors[item.status] || C.textDim, fontWeight: 600 }}>{statusLabels[item.status] || item.status}</span>
                  </td>
                  <td className="mono" style={{ fontSize: 12, color: C.textMid }}>
                    {item.created_at ? new Date(item.created_at).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Track stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 24 }}>
        {[1,2,3,4].map(t => (
          <div key={t} style={{ padding: 16, borderRadius: 10, background: C.surface, border: `1px solid ${C.border}`, textAlign: "center" }}>
            <TrackBadge track={t} />
            <div className="mono" style={{ fontSize: 28, fontWeight: 700, marginTop: 8, color: TRACK_COLORS[t] }}>{trackCounts[t]}</div>
            <div style={{ fontSize: 11, color: C.textMid }}>tools</div>
          </div>
        ))}
      </div>
    </div>
  );
}
