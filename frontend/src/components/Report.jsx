import { useEffect, useMemo, useState } from "react";
import { C, DIMENSION_LABELS, ROUTE_META, SEVERITY_CONFIG, TRACK_LABELS } from "../constants.js";
import { Btn, ErrorBanner, PageHeader, Skeleton, TrackBadge, formatDuration } from "./primitives.jsx";
import { getDocDownloadUrl, getHecvatDownloadUrl, getReport, getTool } from "../api.js";
import { navigate } from "../hooks/useHashRouter.js";
import Breadcrumb from "./Breadcrumb.jsx";

const ACTIONS = {
  1: ["Register the tool in the institutional registry.", "Assign an owner and keep source details current."],
  2: ["Complete the self-assessment.", "Confirm owner sign-off.", "Schedule recurring self-certification."],
  3: ["Submit to IT and security review.", "Resolve review warnings before production.", "Keep annual re-scan on schedule."],
  4: ["Initiate formal IT project governance.", "Pause production deployment until review is complete.", "Maintain human review checkpoints."],
};

const AGENT_TABS = [
  { key: "codeAnalysis", label: "Code & Security" },
  { key: "accessibility", label: "Accessibility" },
  { key: "hecvat", label: "HECVAT" },
  { key: "documentation", label: "Documentation" },
];

const SCORE_KEYS = [
  "score_security", "score_accessibility", "score_data_sensitivity", "score_blast_radius",
  "score_autonomy", "score_comprehension", "score_maintenance",
];

const DIM_KEY_MAP = {
  score_security: "security",
  score_accessibility: "accessibility",
  score_data_sensitivity: "dataSensitivity",
  score_blast_radius: "blastRadius",
  score_autonomy: "autonomy",
  score_comprehension: "comprehension",
  score_maintenance: "maintenance",
};

export default function Report({ toolId, runId }) {
  const [tool, setTool] = useState(null);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("codeAnalysis");

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([getTool(toolId), runId ? getReport(runId) : Promise.resolve(null)])
      .then(([toolData, reportData]) => { setTool(toolData.tool); setReport(reportData?.report || null); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [toolId, runId]);

  const availableTabs = useMemo(() => {
    if (!report?.agents) return [];
    return AGENT_TABS.filter(t => report.agents[t.key]);
  }, [report]);

  useEffect(() => {
    if (availableTabs.length && !availableTabs.find(t => t.key === activeTab)) setActiveTab(availableTabs[0].key);
  }, [availableTabs, activeTab]);

  if (loading) return <LoadingReport />;
  if (error) return <div className="page is-compact"><ErrorBanner message={error} /></div>;
  if (!tool) return null;

  const track = tool.track;
  const pct = tool.weighted_percentage;
  const convergence = report?.agents?.codeAnalysis?.convergenceStats || {};

  return (
    <div className="page">
      <Breadcrumb items={[{ label: "Registry", path: "/" }, { label: tool.name, path: `/tool/${toolId}` }, { label: "Report" }]} />

      <PageHeader eyebrow="Report" title="Review report" subtitle={`${tool.name}${report?.run?.completed_at ? ` \u2022 ${new Date(report.run.completed_at).toLocaleDateString()}` : ""}`}>
        {track ? <TrackBadge track={track} size="lg" /> : null}
      </PageHeader>

      <section className="report-highlight">
        <div className="report-highlight-top">
          <div className="report-highlight-main">
            <div className="eyebrow">Executive summary</div>
            <h2 style={{ marginTop: 8, fontSize: 18 }}>Track {track} — {TRACK_LABELS[track]}</h2>
            <p className="body-copy">{tool.has_escalation ? "Escalation conditions triggered — routed to Track 4." : `Weighted score ${pct}% routes to Track ${track}.`}</p>
            <div className="inline-actions" style={{ marginTop: 14 }}>
              {report?.run?.queued_at && report?.run?.completed_at && <span className="soft-pill">{formatDuration(report.run.queued_at, report.run.completed_at)}</span>}
              <span className="soft-pill">{convergence.confirmed || 0} confirmed</span>
              <span className="soft-pill">{convergence.potential || 0} potential</span>
            </div>
          </div>
          <div className="report-highlight-score">
            <div className="section-label">Weighted score</div>
            <div className="metric-card-value">{pct != null ? `${pct}%` : "-"}</div>
            <div className="metric-card-meta">Track {track}</div>
          </div>
        </div>
      </section>

      <div className="report-grid">
        <section className="section-card">
          <div className="card-header"><div><h2>Dimension scores</h2><p className="card-subtitle">7 weighted dimensions derived from intake and analysis.</p></div></div>
          <div className="inline-score-grid">
            {SCORE_KEYS.map(key => {
              const dimKey = DIM_KEY_MAP[key];
              const score = tool[key];
              return (
                <div key={key} className="metric-card">
                  <div className="section-label">{DIMENSION_LABELS[dimKey]}</div>
                  <div className="metric-card-value">{score ?? "-"}</div>
                  <div className="metric-card-meta">out of 3</div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="section-card">
          <div className="card-header"><div><h2>Required actions</h2><p className="card-subtitle">Next steps for Track {track}.</p></div></div>
          <ul className="checklist" style={{ margin: 0, padding: 0 }}>
            {(ACTIONS[track] || []).map(a => <li key={a}>{a}</li>)}
          </ul>
        </section>
      </div>

      {availableTabs.length > 0 && (
        <section className="section-card">
          <div className="card-header"><div><h2>Agent findings</h2></div></div>
          <div className="tab-row" role="tablist">
            {availableTabs.map(tab => (
              <button key={tab.key} id={`tab-${tab.key}`} type="button" className={activeTab === tab.key ? "is-active" : ""} onClick={() => setActiveTab(tab.key)} role="tab" aria-selected={activeTab === tab.key} aria-controls={`panel-${tab.key}`}>
                {tab.label}
              </button>
            ))}
          </div>
          <div id={`panel-${activeTab}`} role="tabpanel" aria-labelledby={`tab-${activeTab}`} style={{ marginTop: 16 }}>
            <AgentFindings data={report.agents[activeTab]} />
          </div>
        </section>
      )}

      {runId && (
        <section className="section-card">
          <div className="card-header"><div><h2>Generated outputs</h2></div></div>
          <div className="outputs-grid">
            {[["Admin guide","ADMIN_GUIDE.md"],["User guide","USER_GUIDE.md"],["Compliance summary","COMPLIANCE_SUMMARY.md"],["HECVAT 4.15",null]].map(([label, fileName]) => (
              <a key={label} className="doc-card text-link" href={fileName ? getDocDownloadUrl(runId, fileName) : getHecvatDownloadUrl(runId)} style={{ display: "block", textDecoration: "none" }}>
                <div className="section-label">Download</div>
                <h3 style={{ marginTop: 8, fontSize: 14 }}>{label}</h3>
              </a>
            ))}
          </div>
        </section>
      )}

      <div className="page-actions">
        <Btn variant="ghost" onClick={() => navigate(`/tool/${toolId}`)}>Back to tool</Btn>
        <Btn variant="ghost" onClick={() => navigate("/registry")}>Registry</Btn>
      </div>
    </div>
  );
}

function AgentFindings({ data }) {
  if (!data) return <div className="muted">No data available.</div>;
  const findings = data.findings || data.issues || [];
  if (!findings.length && !data.summary) return <div className="muted">No findings recorded.</div>;
  return (
    <div className="section-stack">
      {data.summary && <div className="body-copy" style={{ marginTop: 0 }}>{data.summary}</div>}
      <div className="findings-grid">
        {findings.map((f, i) => {
          const sev = f.severity || f.level || "info";
          const cfg = SEVERITY_CONFIG[sev] || SEVERITY_CONFIG.info;
          return (
            <div key={`${f.title || f.description}-${i}`} className="finding-card" style={{ borderColor: `${cfg.color}30` }}>
              <div className="inline-meta" style={{ marginBottom: 8 }}>
                <span className="severity-pill" style={{ background: cfg.bg, color: cfg.color }}>{cfg.label || sev}</span>
                {f.modelAgreement != null && <span className="mono muted">{f.modelAgreement}/5</span>}
              </div>
              <strong style={{ display: "block", fontSize: 14 }}>{f.title || f.description}</strong>
              {f.detail && <p className="body-copy">{f.detail}</p>}
              {f.location && <span className="soft-pill mono" style={{ marginTop: 8, display: "inline-block" }}>{f.location}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ label, value, meta }) {
  return <div className="metric-card"><div className="section-label">{label}</div><div className="metric-card-value">{value}</div>{meta && <div className="metric-card-meta">{meta}</div>}</div>;
}

function LoadingReport() {
  return (
    <div className="page">
      <Skeleton width={180} height={16} />
      <Skeleton width="56%" height={40} />
      <Skeleton height={180} />
      <div className="summary-grid">{[1,2,3,4].map(i => <Skeleton key={i} height={100} />)}</div>
    </div>
  );
}
