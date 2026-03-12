import { useEffect, useMemo, useState } from "react";
import { parsePossiblyStringArray, ROUTE_META, DIMENSION_LABELS, C } from "../constants.js";
import { Btn, Card, EmptyState, ErrorBanner, PageHeader, Skeleton, StatusBadge, TrackBadge, formatAbsoluteDate, formatDuration, relativeTime } from "./primitives.jsx";
import { deleteTool, getTool, startPipelineRun } from "../api.js";
import { FileText, Clock, ArrowRight } from "lucide-react";
/* M2: decorative icons get aria-hidden in render */
import { navigate } from "../hooks/useHashRouter.js";
import { useToast } from "./Toast.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import Breadcrumb from "./Breadcrumb.jsx";
import ReviewPanel from "./ReviewPanel.jsx";

const SCORE_KEYS = [
  ["score_security", "security"],
  ["score_accessibility", "accessibility"],
  ["score_data_sensitivity", "dataSensitivity"],
  ["score_blast_radius", "blastRadius"],
  ["score_autonomy", "autonomy"],
  ["score_comprehension", "comprehension"],
  ["score_maintenance", "maintenance"],
];

const Q_LABELS = {
  q1: "What best describes what you built?",
  q2: "Is this tool already in production?",
  q3: "Who will use this tool?",
  q4: "Describe what this tool does",
  q5: "Where will this tool be accessible?",
  q6: "Does this tool use campus SSO?",
  q7: "What infrastructure does this tool require?",
  q8: "Expected number of users?",
  q9: "Does this tool handle data?",
  q10: "What kind of data?",
  q11: "Where does the data live?",
  q12: "Does data leave campus for AI processing?",
  q13: "AI model provider and model?",
  q14: "Who owns this tool?",
  q15: "Is the code in version control?",
  q16: "If you left UM tomorrow, what happens?",
  q17: "Expected maintenance model?",
  q18: "If this tool breaks, who fixes it?",
  q19: "Explain what the tool does and what happens when it fails",
  q20: "What decisions does this tool make or influence?",
  q21: "Will users know they're interacting with AI?",
};

export default function ToolDetail({ toolId }) {
  const { user } = useAuth();
  const { toast, confirm } = useToast();
  const [tool, setTool] = useState(null);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [runningPipeline, setRunningPipeline] = useState(false);

  useEffect(() => { load(); }, [toolId]);

  function load() {
    setLoading(true);
    setError(null);
    getTool(toolId)
      .then(data => { setTool(data.tool); setRuns(data.runs || []); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }

  async function handleDelete() {
    const yes = await confirm({ title: "Delete this tool?", message: `"${tool?.name}" and all runs will be deleted.`, destructive: true, confirmLabel: "Delete" });
    if (!yes) return;
    setDeleting(true);
    try { await deleteTool(toolId); toast.success(`"${tool?.name}" deleted`); navigate("/registry"); }
    catch (err) { toast.error(err.message); setDeleting(false); }
  }

  async function handleRunPipeline() {
    setRunningPipeline(true);
    try {
      const result = await startPipelineRun(toolId, tool.track);
      toast.success("Pipeline started");
      navigate(`/tool/${toolId}/pipeline/${result.run.id}`);
    } catch (err) { toast.error(err.message); setRunningPipeline(false); }
  }

  const latestRun = runs[0] || null;
  const isRunning = latestRun?.status === "running" || latestRun?.status === "queued";
  const escalationConditions = useMemo(() => parsePossiblyStringArray(tool?.escalation_conditions), [tool?.escalation_conditions]);

  if (loading) return <LoadingDetail />;
  if (error) return <div className="page is-compact"><ErrorBanner message={error} onRetry={load} /></div>;
  if (!tool) return <div className="page is-compact"><EmptyState heading="Tool not found" action={<Btn onClick={() => navigate("/registry")}>Registry</Btn>} /></div>;

  return (
    <div className="page">
      <Breadcrumb items={[{ label: "Registry", path: "/registry" }, { label: tool.name }]} />
      <PageHeader eyebrow="Tool Detail" title={tool.name} subtitle={tool.description || "No description."}>
        <StatusBadge status={tool.status} />
        {tool.track ? <TrackBadge track={tool.track} size="lg" /> : null}
      </PageHeader>

      <div className="summary-grid">
        <StatCard label="Track" value={tool.track ? `Track ${tool.track}` : "Pending"} meta={tool.track ? "From intake scoring" : ""} />
        <StatCard label="Weighted score" value={tool.weighted_percentage != null ? `${tool.weighted_percentage}%` : "-"} meta="Percentage" />
        <StatCard label="Latest run" value={latestRun ? relativeTime(latestRun.queued_at) : "None"} meta={latestRun?.status || ""} />
        <StatCard label="Owner" value={tool.owner_name || tool.owner_netid || "Unassigned"} meta={tool.updated_at ? `Updated ${relativeTime(tool.updated_at)}` : ""} />
      </div>

      {latestRun?.status === "completed" && (
        <div style={{ display: "flex", gap: 12 }}>
          <button type="button" onClick={() => navigate(`/review/${toolId}`)}
            className="section-card" style={{
              flex: 1, display: "flex", alignItems: "center", gap: 16, padding: "16px 20px",
              cursor: "pointer", border: `1px solid ${C.accent}30`, background: C.accentSoft,
              textAlign: "left", fontFamily: "'DM Sans', sans-serif",
              borderRadius: 10, transition: "border-color .15s",
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = C.accent}
            onMouseLeave={e => e.currentTarget.style.borderColor = `${C.accent}30`}
            onFocus={e => e.currentTarget.style.borderColor = C.accent}
            onBlur={e => e.currentTarget.style.borderColor = `${C.accent}30`}
          >
            <div style={{ width: 40, height: 40, borderRadius: 10, background: `${C.accent}18`,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <FileText size={20} color={C.accent} aria-hidden="true" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Code Review</div>
              <div style={{ fontSize: 12, color: C.textMid, marginTop: 2 }}>File tree, findings, and remediation</div>
            </div>
            <ArrowRight size={16} color={C.textMid} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => navigate(`/tool/${toolId}/report/${latestRun.id}`)}
            className="section-card" style={{
              flex: 1, display: "flex", alignItems: "center", gap: 16, padding: "16px 20px",
              cursor: "pointer", border: `1px solid ${C.border}`, background: "transparent",
              textAlign: "left", fontFamily: "'DM Sans', sans-serif",
              borderRadius: 10, transition: "border-color .15s",
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = C.accent}
            onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
            onFocus={e => e.currentTarget.style.borderColor = C.accent}
            onBlur={e => e.currentTarget.style.borderColor = C.border}
          >
            <div style={{ width: 40, height: 40, borderRadius: 10, background: C.surface,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Clock size={20} color={C.textMid} aria-hidden="true" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Summary Report</div>
              <div style={{ fontSize: 12, color: C.textMid, marginTop: 2 }}>
                {latestRun.completed_at ? `Completed ${relativeTime(latestRun.completed_at)}` : "Completed"}
                {latestRun.queued_at && latestRun.completed_at && <> &middot; {formatDuration(latestRun.queued_at, latestRun.completed_at)}</>}
              </div>
            </div>
            <ArrowRight size={16} color={C.textMid} aria-hidden="true" />
          </button>
        </div>
      )}

      {isRunning && (
        <button type="button" onClick={() => navigate(`/tool/${toolId}/pipeline/${latestRun.id}`)}
          className="section-card" style={{
            display: "flex", alignItems: "center", gap: 16, padding: "16px 20px",
            cursor: "pointer", border: `1px solid ${C.warning}40`, background: `${C.warning}08`,
            width: "100%", textAlign: "left", fontFamily: "'DM Sans', sans-serif",
            borderRadius: 10, transition: "border-color .15s",
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = C.warning}
          onMouseLeave={e => e.currentTarget.style.borderColor = `${C.warning}40`}
          onFocus={e => e.currentTarget.style.borderColor = C.warning}
          onBlur={e => e.currentTarget.style.borderColor = `${C.warning}40`}
        >
          <div style={{ width: 40, height: 40, borderRadius: 10, background: `${C.warning}18`,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Clock size={20} color={C.warning} aria-hidden="true" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Pipeline Running</div>
            <div style={{ fontSize: 12, color: C.textMid, marginTop: 2 }}>Started {relativeTime(latestRun.queued_at)} &middot; View progress</div>
          </div>
          <ArrowRight size={16} color={C.textMid} aria-hidden="true" />
        </button>
      )}

      <div className="wizard-layout">
        <div className="section-stack">
          <section className="section-card">
            <div className="card-header"><div><h2>Summary</h2></div></div>
            <div className="review-grid">
              <div className="meta-item"><strong>Submission type</strong><span>{tool.submission_type || "-"}</span></div>
              <div className="meta-item"><strong>Artifact type</strong><span>{tool.artifact_type || "-"}</span></div>
              <div className="meta-item"><strong>Created</strong><span>{formatAbsoluteDate(tool.created_at)}</span></div>
              <div className="meta-item"><strong>Escalation</strong><span>{tool.has_escalation ? "Triggered" : "None"}</span></div>
            </div>
            {tool.has_escalation && escalationConditions.length > 0 && (
              <div className="error-banner" style={{ marginTop: 16 }}>
                <div>
                  <strong style={{ display: "block", marginBottom: 6 }}>Escalation conditions</strong>
                  {escalationConditions.map(c => <div key={c} style={{ fontSize: 13, marginBottom: 4 }}>{c}</div>)}
                </div>
              </div>
            )}
          </section>

          <section className="section-card">
            <div className="card-header"><div><h2>Dimension scores</h2></div></div>
            <dl className="inline-score-grid" style={{ margin: 0 }}>
              {SCORE_KEYS.map(([col, dimKey]) => (
                <div key={col} className="metric-card">
                  <dt className="section-label">{DIMENSION_LABELS[dimKey]}</dt>
                  <dd style={{ margin: 0 }}><div className="metric-card-value">{tool[col] ?? "-"}</div>
                  <div className="metric-card-meta">out of 3</div></dd>
                </div>
              ))}
            </dl>
          </section>

          {tool.intake_answers && Object.keys(tool.intake_answers).length > 0 && (
            <section className="section-card">
              <div className="card-header"><div><h2>Intake Answers</h2></div></div>
              <div className="data-list">
                {Object.entries(tool.intake_answers)
                  .filter(([k]) => Q_LABELS[k])
                  .sort(([a], [b]) => parseInt(a.slice(1)) - parseInt(b.slice(1)))
                  .map(([k, v]) => (
                    <div key={k} className="data-row" style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
                        <span className="mono" style={{ fontSize: 10, color: C.accent, fontWeight: 600 }}>{k.toUpperCase()}</span>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{Q_LABELS[k]}</span>
                      </div>
                      <div style={{ fontSize: 13, color: C.textMid, marginLeft: 32 }}>
                        {Array.isArray(v) ? v.join(", ") : (typeof v === "string" && v.length > 100
                          ? <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{v}</div>
                          : String(v))}
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          )}
        </div>

        <div className="sticky-column">
          {/* Review panel for reviewers/admins or tool owner */}
          {user && (user.role === "reviewer" || user.role === "admin" || tool.owner_id === user.userId) && (
            <ReviewPanel tool={tool} onUpdate={(updated) => setTool(prev => ({ ...prev, ...updated }))} />
          )}

          <section className="action-card">
            <div className="card-header"><div><h2>Actions</h2></div></div>
            <div className="section-stack">
              {tool.status === "draft" && <>
                <Btn onClick={() => navigate(`/intake/${tool.id}`)}>Resume and submit</Btn>
                <Btn variant="ghost" onClick={handleDelete} disabled={deleting}>{deleting ? "Deleting..." : "Delete draft"}</Btn>
              </>}
              {tool.status === "pending" && !isRunning && <>
                <Btn onClick={() => navigate(`/upload/${toolId}`)}>Upload & Run Pipeline</Btn>
                <Btn variant="ghost" onClick={handleDelete} disabled={deleting}>{deleting ? "Deleting..." : "Delete"}</Btn>
              </>}
              {isRunning && <>
                <div className="info-banner"><div><strong>Pipeline running.</strong> You can leave and come back anytime.</div></div>
                <Btn onClick={() => navigate(`/upload/${toolId}`)}>View progress</Btn>
              </>}
              {tool.status === "changes_requested" && !isRunning && <>
                <div className="info-banner" style={{ borderColor: C.warning }}>
                  <div><strong style={{ color: C.warning }}>Changes requested.</strong> Address the feedback, then re-submit.</div>
                </div>
                {latestRun?.status === "completed" && <Btn onClick={() => navigate(`/tool/${toolId}/report/${latestRun.id}`)}>View report</Btn>}
                <Btn variant="ghost" onClick={() => navigate(`/upload/${toolId}`)}>Re-run pipeline</Btn>
              </>}
              {tool.status === "approved" && <>
                <div className="info-banner" style={{ borderColor: C.success }}>
                  <div><strong style={{ color: C.success }}>Approved.</strong> A reviewer can now activate this tool.</div>
                </div>
                {latestRun?.status === "completed" && <Btn variant="ghost" onClick={() => navigate(`/tool/${toolId}/report/${latestRun.id}`)}>View report</Btn>}
              </>}
              {!["draft", "pending", "changes_requested", "approved"].includes(tool.status) && latestRun?.status === "completed" && !isRunning && <>
                <Btn onClick={() => navigate(`/tool/${toolId}/report/${latestRun.id}`)}>Latest report</Btn>
                <Btn variant="ghost" onClick={() => navigate(`/upload/${toolId}`)}>Re-run</Btn>
              </>}
              {latestRun?.status === "failed" && !isRunning && <>
                <Btn onClick={() => navigate(`/upload/${toolId}`)}>Upload & Re-run</Btn>
                <Btn variant="ghost" onClick={() => navigate(`/tool/${toolId}/pipeline/${latestRun.id}`)}>View failed run</Btn>
              </>}
            </div>
          </section>

          {runs.length > 0 && (
            <Card style={{ marginTop: 16 }}>
              <div className="card-header"><div><h2>Run history</h2></div></div>
              <div className="data-list">
                {runs.map(run => (
                  <div key={run.id} className="data-row" style={{ padding: "10px 14px" }}>
                    <div className="inline-meta">
                      <StatusBadge status={run.status} />
                      <span className="mono" style={{ fontSize: 12 }}>Track {run.track}</span>
                    </div>
                    <div style={{ marginTop: 8, fontWeight: 700, fontSize: 13 }}>{relativeTime(run.queued_at)}</div>
                    {run.completed_at && <div className="muted" style={{ marginTop: 4 }}>Completed in {formatDuration(run.queued_at, run.completed_at)}</div>}
                    {run.status === "completed" && (
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button type="button" onClick={() => navigate(`/review/${toolId}/${run.id}`)}
                          style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.accent}40`, background: C.accentSoft,
                            cursor: "pointer", fontSize: 11, fontWeight: 600, color: C.accent, fontFamily: "'DM Sans', sans-serif" }}>
                          Findings
                        </button>
                        <button type="button" onClick={() => navigate(`/tool/${toolId}/report/${run.id}`)}
                          style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent",
                            cursor: "pointer", fontSize: 11, fontWeight: 600, color: C.textMid, fontFamily: "'DM Sans', sans-serif" }}>
                          Report
                        </button>
                      </div>
                    )}
                    {run.status !== "completed" && (
                      <button type="button" onClick={() => navigate(`/tool/${toolId}/pipeline/${run.id}`)}
                        style={{ marginTop: 8, padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent",
                          cursor: "pointer", fontSize: 11, fontWeight: 600, color: C.textMid, fontFamily: "'DM Sans', sans-serif" }}>
                        View {run.status === "running" || run.status === "queued" ? "progress" : "details"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, meta }) {
  return <div className="metric-card"><div className="section-label">{label}</div><div className="metric-card-value">{value}</div>{meta && <div className="metric-card-meta">{meta}</div>}</div>;
}

function LoadingDetail() {
  return (
    <div className="page">
      <Skeleton width={180} height={16} />
      <Skeleton width="48%" height={40} />
      <div className="summary-grid">{[1,2,3,4].map(i => <Skeleton key={i} height={120} />)}</div>
    </div>
  );
}
