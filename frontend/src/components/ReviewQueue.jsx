import { useEffect, useMemo, useState } from "react";
import { C, TRACK_COLORS } from "../constants.js";
import { Btn, EmptyState, ErrorBanner, TrackBadge, Skeleton, StatusBadge, relativeTime } from "./primitives.jsx";
import { getReviewQueue } from "../api.js";
import { navigate } from "../hooks/useHashRouter.js";

export default function ReviewQueue() {
  const [filter, setFilter] = useState("all");
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    getReviewQueue()
      .then(data => setTools(data.tools || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return tools;
    return tools.filter(t => t.status === filter);
  }, [filter, tools]);

  const underReviewCount = tools.filter(t => t.status === "under_review").length;
  const changesCount = tools.filter(t => t.status === "changes_requested").length;

  if (loading) return <div style={{ padding: 20 }}><Skeleton height={300} /></div>;
  if (error) return <div style={{ padding: 20 }}><ErrorBanner message={error} /></div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Review Queue</h3>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textMid }}>
            {tools.length} tools awaiting action &middot; {underReviewCount} under review &middot; {changesCount} changes requested
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[["all", "All"], ["under_review", "Under Review"], ["changes_requested", "Changes Req."]].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)}
              style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${filter === v ? C.accent : C.border}`,
                background: filter === v ? C.accentSoft : "transparent", color: filter === v ? C.accent : C.textMid,
                fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState heading="No tools to review" body="All caught up." />
      ) : (
        <div style={{ borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
          <div className="registry-table-header">
            <span>Tool Name</span><span>Track</span><span>Builder</span><span>Status</span><span>Waiting Since</span><span>Latest Run</span>
          </div>
          {filtered.map((item, i) => {
            const waitingSince = item.updated_at ? relativeTime(item.updated_at) : "—";
            return (
              <div key={item.id} className="registry-table-row"
                style={{ background: i % 2 === 0 ? "transparent" : C.surface }}
                onClick={() => navigate(`/tool/${item.id}`)}
                onMouseEnter={e => e.currentTarget.style.background = C.surfaceHover}
                onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "transparent" : C.surface}>
                <span style={{ fontWeight: 600 }}>{item.name}</span>
                <span>{item.track ? <TrackBadge track={item.track} /> : "—"}</span>
                <span style={{ color: C.textMid }}>{item.owner_name || item.owner_netid || "—"}</span>
                <span><StatusBadge status={item.status} /></span>
                <span style={{ fontSize: 12, color: C.textMid }}>{waitingSince}</span>
                <span style={{ fontSize: 12, color: C.textMid }}>{item.latest_run_status || "—"}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
