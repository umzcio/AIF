import { useEffect, useState, useMemo } from "react";
import { C, TRACK_COLORS, STATUS_META } from "../constants.js";
import { Btn, ErrorBanner, Skeleton, TrackBadge, relativeTime } from "./primitives.jsx";
import { getAdminDashboard, getAuditLog, getUsers, updateUserRole, toggleUserActive,
  getAnalyticsOverview, getAnalyticsTrends } from "../api.js";
import { navigate } from "../hooks/useHashRouter.js";
import { useAuth } from "../hooks/useAuth.jsx";
import { useToast } from "./Toast.jsx";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "analytics", label: "Pipeline Analytics" },
  { id: "users", label: "Users" },
  { id: "audit", label: "Audit Log" },
];

export default function AdminDashboard() {
  const [tab, setTab] = useState("overview");

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Admin Dashboard</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textMid }}>System overview and management</p>
      </div>

      {/* Tab bar */}
      <div role="tablist" aria-label="Admin sections" style={{ display: "flex", gap: 2, marginBottom: 24, borderBottom: `1px solid ${C.border}` }}
        onKeyDown={e => {
          const idx = TABS.findIndex(t => t.id === tab);
          if (e.key === "ArrowRight") { e.preventDefault(); setTab(TABS[(idx + 1) % TABS.length].id); }
          if (e.key === "ArrowLeft") { e.preventDefault(); setTab(TABS[(idx - 1 + TABS.length) % TABS.length].id); }
        }}>
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} aria-controls={`tabpanel-${t.id}`}
            id={`tab-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
              background: "transparent", color: tab === t.id ? C.accent : C.textMid,
              borderBottom: `2px solid ${tab === t.id ? C.accent : "transparent"}`,
              fontFamily: "'DM Sans', sans-serif", transition: "color .15s, border-color .15s",
              marginBottom: -1 }}>
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "overview" && <OverviewTab />}
        {tab === "analytics" && <AnalyticsTab />}
        {tab === "users" && <UsersTab />}
        {tab === "audit" && <AuditTab />}
      </div>
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
      <div className="responsive-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        <SummaryCard label="Total Tools" value={stats.totalTools} />
        <SummaryCard label="Pending Reviews" value={stats.pendingReviews} accent={stats.pendingReviews > 0 ? C.warning : null} />
        <SummaryCard label="Pipeline Runs (30d)" value={stats.recentPipelineRuns} />
        <SummaryCard label="Active Users" value={`${stats.activeUsers} / ${stats.totalUsers}`} />
      </div>

      {/* Tools by Track / Status */}
      <div className="responsive-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
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

/* ── Analytics Tab ── */

/** Model display metadata — colors match agent colors from constants.js */
const MODEL_META = {
  "Pass 1 (Codex/GPT-5.4)": { short: "Codex", color: "#F97316" },
  "Pass 2 (Gemini 2.5 Pro)": { short: "Gemini", color: "#8B5CF6" },
  "Pass 3 (Grok)": { short: "Grok", color: "#06B6D4" },
  "Pass 4 (Kimi K2)": { short: "Kimi K2", color: "#22C55E" },
  "Pass 5 (Qwen3 Coder)": { short: "Qwen3", color: "#EC4899" },
};

function getModelMeta(name) {
  return MODEL_META[name] || { short: name?.split("(")[1]?.replace(")", "") || name, color: C.textMid };
}

function fmtDuration(seconds) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function fmtCost(usd) {
  if (usd == null || usd === 0) return "$0.00";
  return `$${usd.toFixed(2)}`;
}

function pct(n, d) {
  if (!d) return "0%";
  return `${Math.round((n / d) * 100)}%`;
}

function AnalyticsTab() {
  const [data, setData] = useState(null);
  const [trends, setTrends] = useState(null);
  const [days, setDays] = useState(90);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([getAnalyticsOverview(days), getAnalyticsTrends(days)])
      .then(([overview, trendData]) => { setData(overview); setTrends(trendData); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [days]);

  if (loading) return <Skeleton height={500} />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;

  const { runs, cost, passes, models, recentRuns } = data;

  return (
    <>
      {/* Period selector */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
        <span style={{ fontSize: 12, color: C.textMid, fontWeight: 600 }}>Period:</span>
        {[30, 90, 180, 365].map(d => (
          <button key={d} type="button" onClick={() => setDays(d)}
            style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${days === d ? C.accent : C.border}`,
              background: days === d ? C.accentSoft : "transparent", color: days === d ? C.accent : C.textMid,
              fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
            {d}d
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="responsive-grid-5" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 24 }}>
        <SummaryCard label="Total Runs" value={runs.total} />
        <SummaryCard label="Success Rate" value={pct(runs.completed, runs.total)}
          accent={runs.total > 0 && runs.completed / runs.total < 0.8 ? C.warning : C.success} />
        <SummaryCard label="Avg Duration" value={fmtDuration(runs.avgDurationSeconds)} />
        <SummaryCard label="Total Cost" value={fmtCost(cost.total)} />
        <SummaryCard label="Avg Cost/Run" value={fmtCost(cost.avgPerRun)} />
      </div>

      {/* Model Performance Comparison */}
      {models.length > 0 && (
        <section className="section-card" style={{ padding: 16, marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Model Performance Comparison</div>

          {/* Bar chart visualization */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Average Duration (seconds)
            </div>
            {models.map(m => {
              const meta = getModelMeta(m.name);
              const maxSec = Math.max(...models.map(x => x.maxSeconds || 0), 1);
              return (
                <div key={m.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 70, fontSize: 12, fontWeight: 600, color: meta.color, textAlign: "right" }}>
                    {meta.short}
                  </div>
                  <div style={{ flex: 1, position: "relative", height: 24, background: C.surface, borderRadius: 4, overflow: "hidden" }}>
                    {/* Avg bar */}
                    <div style={{
                      position: "absolute", top: 2, left: 0, height: 20, borderRadius: 3,
                      background: meta.color, opacity: 0.25,
                      width: `${((m.maxSeconds || 0) / maxSec) * 100}%`,
                    }} />
                    <div style={{
                      position: "absolute", top: 2, left: 0, height: 20, borderRadius: 3,
                      background: meta.color,
                      width: `${((m.avgSeconds || 0) / maxSec) * 100}%`,
                    }} />
                    {/* Median marker */}
                    {m.medianSeconds != null && (
                      <div style={{
                        position: "absolute", top: 0, height: 24, width: 2,
                        background: "#fff", opacity: 0.8,
                        left: `${((m.medianSeconds) / maxSec) * 100}%`,
                      }} />
                    )}
                    <span style={{ position: "absolute", top: 3, left: 8, fontSize: 11, fontWeight: 600,
                      color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}>
                      {fmtDuration(m.avgSeconds)}
                    </span>
                  </div>
                  <div style={{ width: 45, fontSize: 11, color: C.textDim, textAlign: "right" }}>
                    {pct(m.successes, m.totalRuns)}
                  </div>
                </div>
              );
            })}
            <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 10, color: C.textDim }}>
              <span>Solid = avg &nbsp; Faded = max &nbsp; Line = median &nbsp; Right = success rate</span>
            </div>
          </div>

          {/* Model detail table */}
          <div style={{ borderRadius: 8, border: `1px solid ${C.border}`, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr className="registry-table-header" style={{ gridTemplateColumns: "140px 60px 60px 60px 80px 80px 80px 80px 80px" }}>
                  <th scope="col">Model</th><th scope="col">Runs</th><th scope="col">OK</th><th scope="col">Fail</th>
                  <th scope="col">Avg Time</th><th scope="col">Min</th><th scope="col">Max</th>
                  <th scope="col">Timeouts</th><th scope="col">Parse Fail</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m, i) => {
                  const meta = getModelMeta(m.name);
                  return (
                    <tr key={m.name} className="registry-table-row"
                      style={{ background: i % 2 === 0 ? "transparent" : C.surface,
                        gridTemplateColumns: "140px 60px 60px 60px 80px 80px 80px 80px 80px", cursor: "default" }}>
                      <td style={{ fontWeight: 600, color: meta.color, fontSize: 12 }}>{meta.short}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{m.totalRuns}</td>
                      <td className="mono" style={{ fontSize: 12, color: C.success }}>{m.successes}</td>
                      <td className="mono" style={{ fontSize: 12, color: m.failures > 0 ? C.danger : C.textDim }}>{m.failures}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{fmtDuration(m.avgSeconds)}</td>
                      <td className="mono" style={{ fontSize: 12, color: C.textDim }}>{fmtDuration(m.minSeconds)}</td>
                      <td className="mono" style={{ fontSize: 12, color: m.maxSeconds > 300 ? C.warning : C.textDim }}>{fmtDuration(m.maxSeconds)}</td>
                      <td className="mono" style={{ fontSize: 12, color: m.timeouts > 0 ? C.danger : C.textDim }}>{m.timeouts}</td>
                      <td className="mono" style={{ fontSize: 12, color: m.parseFailures > 0 ? C.warning : C.textDim }}>{m.parseFailures}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Pipeline Runs + Trends side by side */}
      <div className="responsive-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        {/* Run Status Breakdown */}
        <section className="section-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Run Status Breakdown</div>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { label: "Completed", value: runs.completed, color: C.success },
              { label: "Failed", value: runs.failed, color: C.danger },
              { label: "Cancelled", value: runs.cancelled, color: C.warning },
            ].map(s => (
              <div key={s.label} style={{ flex: 1, textAlign: "center", padding: 12, borderRadius: 8,
                background: `${s.color}10`, border: `1px solid ${s.color}30` }}>
                <div className="mono" style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 11, color: C.textMid, marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
          {runs.avgRetries > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: C.textMid }}>
              Avg retries per run: <span className="mono" style={{ fontWeight: 600 }}>{runs.avgRetries.toFixed(1)}</span>
            </div>
          )}
        </section>

        {/* Pass-Level Stats */}
        <section className="section-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Pass-Level Statistics</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <MiniStat label="Total Passes" value={passes.total} />
            <MiniStat label="Success Rate" value={pct(passes.completed, passes.total)}
              color={passes.total > 0 && passes.completed / passes.total < 0.9 ? C.warning : C.success} />
            <MiniStat label="Avg Pass Time" value={fmtDuration(passes.avgSeconds)} />
            <MiniStat label="JSON Parse Fails" value={passes.jsonParseFailures}
              color={passes.jsonParseFailures > 0 ? C.warning : null} />
            <MiniStat label="Avg Attempts" value={passes.avgAttempts.toFixed(1)} />
            <MiniStat label="Median Duration" value={fmtDuration(runs.medianDurationSeconds)} />
          </div>
        </section>
      </div>

      {/* Cost/Duration Trend */}
      {trends?.timeSeries?.length > 1 && (
        <section className="section-card" style={{ padding: 16, marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            Pipeline Trends ({trends.period.bucket === "day" ? "Daily" : "Weekly"})
          </div>
          <TrendChart data={trends.timeSeries} />
        </section>
      )}

      {/* Recent Runs Table */}
      {recentRuns.length > 0 && (
        <section className="section-card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <div><h2>Recent Pipeline Runs</h2></div>
          </div>
          <div style={{ borderRadius: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr className="registry-table-header" style={{ gridTemplateColumns: "1fr 60px 80px 90px 80px 80px 80px" }}>
                  <th scope="col">Tool</th><th scope="col">Track</th><th scope="col">Status</th><th scope="col">Duration</th>
                  <th scope="col">Models</th><th scope="col">Cost</th><th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.slice(0, 20).map((r, i) => {
                  const statusMeta = STATUS_META[r.status] || {};
                  return (
                    <tr key={r.id} className="registry-table-row"
                      style={{ background: i % 2 === 0 ? "transparent" : C.surface,
                        gridTemplateColumns: "1fr 60px 80px 90px 80px 80px 80px", cursor: "default" }}>
                      <td style={{ fontSize: 12, fontWeight: 600 }}>{r.tool_name || "—"}</td>
                      <td><TrackBadge track={r.track} /></td>
                      <td style={{ fontSize: 11, fontWeight: 600, color: statusMeta.color || C.textMid }}>{statusMeta.label || r.status}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{fmtDuration(r.total_elapsed_seconds)}</td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {r.models_succeeded != null ? `${r.models_succeeded}/${(r.models_succeeded || 0) + (r.models_failed || 0)}` : "—"}
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>{fmtCost(r.estimated_cost_usd)}</td>
                      <td style={{ fontSize: 11, color: C.textDim }}>{relativeTime(r.queued_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

/** Simple mini stat for grid layout */
function MiniStat({ label, value, color }) {
  return (
    <div style={{ padding: 8, borderRadius: 6, background: C.surface }}>
      <div style={{ fontSize: 10, color: C.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>{label}</div>
      <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: color || C.text }}>{value}</div>
    </div>
  );
}

/** Sparkline-style trend chart using CSS/inline elements */
function TrendChart({ data }) {
  if (!data || data.length === 0) return null;

  const maxRuns = Math.max(...data.map(d => d.runs), 1);
  const maxCost = Math.max(...data.map(d => d.totalCost), 0.01);
  const maxDur = Math.max(...data.map(d => d.avgDuration || 0), 1);
  const barW = Math.max(8, Math.min(40, Math.floor(600 / data.length) - 2));

  return (
    <div>
      {/* Runs + success rate bars */}
      <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
        Runs (green = completed, red = failed)
      </div>
      <div role="img" aria-label="Runs trend chart: green bars for completed, red for failed" style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 80, marginBottom: 12 }}>
        {data.map((d, i) => {
          const h = (d.runs / maxRuns) * 72;
          const failH = (d.failed / maxRuns) * 72;
          return (
            <div key={i} aria-hidden="true" style={{ position: "relative", width: barW, height: 72 }}
              title={`${new Date(d.period).toLocaleDateString()}: ${d.runs} runs (${d.completed} ok, ${d.failed} failed)`}>
              <div style={{ position: "absolute", bottom: 0, width: "100%", height: h, borderRadius: 3, background: C.success, opacity: 0.3 }} />
              <div style={{ position: "absolute", bottom: 0, width: "100%", height: (d.completed / maxRuns) * 72, borderRadius: 3, background: C.success }} />
              {failH > 0 && (
                <div style={{ position: "absolute", bottom: 0, width: "100%", height: failH, borderRadius: "0 0 3px 3px", background: C.danger, opacity: 0.6 }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Duration trend line (simulated with bars) */}
      <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
        Avg Duration
      </div>
      <div role="img" aria-label="Average duration trend chart" style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 50, marginBottom: 12 }}>
        {data.map((d, i) => (
          <div key={i} aria-hidden="true" style={{ width: barW, borderRadius: 3,
            height: d.avgDuration ? `${(d.avgDuration / maxDur) * 44}px` : 0,
            background: C.accent, opacity: 0.6 }}
            title={`${new Date(d.period).toLocaleDateString()}: ${fmtDuration(d.avgDuration)}`} />
        ))}
      </div>

      {/* Cost trend */}
      <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
        Cost per Period
      </div>
      <div role="img" aria-label="Cost per period trend chart" style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 50 }}>
        {data.map((d, i) => (
          <div key={i} aria-hidden="true" style={{ width: barW, borderRadius: 3,
            height: d.totalCost ? `${(d.totalCost / maxCost) * 44}px` : 0,
            background: C.gold, opacity: 0.7 }}
            title={`${new Date(d.period).toLocaleDateString()}: ${fmtCost(d.totalCost)}`} />
        ))}
      </div>

      {/* Date labels */}
      <div style={{ display: "flex", gap: 2, marginTop: 4 }}>
        {data.map((d, i) => {
          // Only show some labels to avoid overlap
          const showLabel = i === 0 || i === data.length - 1 || i % Math.ceil(data.length / 6) === 0;
          return (
            <div key={i} style={{ width: barW, fontSize: 9, color: C.textDim, textAlign: "center", overflow: "hidden" }}>
              {showLabel ? new Date(d.period).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}
            </div>
          );
        })}
      </div>
    </div>
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
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr className="registry-table-header" style={{ gridTemplateColumns: "1fr 1fr 120px 120px 80px 80px" }}>
              <th scope="col">Name</th><th scope="col">NetID</th><th scope="col">Role</th><th scope="col">Last Login</th><th scope="col">Tools</th><th scope="col">Active</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u, i) => {
              const isSelf = currentUser?.userId === u.id;
              return (
                <tr key={u.id} className="registry-table-row"
                  style={{ background: i % 2 === 0 ? "transparent" : C.surface, gridTemplateColumns: "1fr 1fr 120px 120px 80px 80px" }}>
                  <td style={{ fontWeight: 600 }}>{u.display_name || "—"}</td>
                  <td className="mono" style={{ fontSize: 12, color: C.textMid }}>{u.netid}</td>
                  <td>
                    <select value={u.role} aria-label={`Role for ${u.netid}`}
                      onChange={e => handleRoleChange(u.id, e.target.value, u.netid)}
                      disabled={isSelf}
                      style={{ padding: "3px 6px", borderRadius: 4, border: `1px solid ${C.border}`,
                        background: C.surface, color: C.text, fontSize: 12,
                        fontFamily: "'DM Sans', sans-serif", cursor: isSelf ? "not-allowed" : "pointer" }}>
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td style={{ fontSize: 12, color: C.textMid }}>
                    {u.last_login ? relativeTime(u.last_login) : "Never"}
                  </td>
                  <td className="mono" style={{ fontSize: 12, textAlign: "center" }}>{u.tool_count}</td>
                  <td style={{ textAlign: "center" }}>
                    <button type="button" role="switch" aria-checked={u.is_active}
                      aria-label={`${u.is_active ? "Deactivate" : "Activate"} ${u.netid}`}
                      onClick={() => !isSelf && handleToggleActive(u.id, u.is_active, u.netid)}
                      disabled={isSelf}
                      style={{ width: 44, height: 28, borderRadius: 14, border: "none", cursor: isSelf ? "not-allowed" : "pointer",
                        background: u.is_active ? C.accent : C.border, position: "relative", transition: "background .2s" }}>
                      <span style={{ position: "absolute", top: 3, left: u.is_active ? 22 : 3,
                        width: 22, height: 22, borderRadius: "50%", background: "#fff",
                        transition: "left .2s", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr className="registry-table-header" style={{ gridTemplateColumns: "160px 100px 140px 100px 1fr" }}>
                  <th scope="col">Timestamp</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Entity</th><th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 20, textAlign: "center", fontSize: 13, color: C.textDim }}>No entries found.</td></tr>
                ) : entries.map((entry, i) => (
                  <tr key={entry.id} className="registry-table-row"
                    style={{ background: i % 2 === 0 ? "transparent" : C.surface,
                      gridTemplateColumns: "160px 100px 140px 100px 1fr", cursor: "default" }}>
                    <td className="mono" style={{ fontSize: 11, color: C.textDim }}>
                      {new Date(entry.created_at).toLocaleString()}
                    </td>
                    <td style={{ fontSize: 12, fontWeight: 600, color: C.accent }}>{entry.actor_netid}</td>
                    <td style={{ fontSize: 12, color: C.textMid }}>{entry.action.replace(/_/g, " ")}</td>
                    <td style={{ fontSize: 11, color: C.textDim }}>
                      {entry.entity_type}/{entry.entity_id?.slice(0, 8)}
                    </td>
                    <td style={{ fontSize: 11, color: C.textDim, overflow: "hidden", textOverflow: "ellipsis", minHeight: "auto" }}>
                      {entry.details ? JSON.stringify(entry.details) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
