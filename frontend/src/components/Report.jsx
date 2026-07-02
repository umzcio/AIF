import { useEffect, useMemo, useState } from "react";
import { C, DIMENSION_LABELS, ROUTE_META, SEVERITY_CONFIG, TRACK_LABELS } from "../constants.js";
import { Btn, ErrorBanner, PageHeader, Skeleton, TrackBadge, formatDuration } from "./primitives.jsx";
import { getDocDownloadUrl, getHecvatDownloadUrl, getFindingsCsvUrl, getFindingsJsonUrl, getReport, getTool } from "../api.js";
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
  { key: "qaAnalysis", label: "QA / Bugs" },
  { key: "hecvat", label: "HECVAT" },
  { key: "documentation", label: "Documentation" },
];

const PASS_MODEL_NAMES = {
  pass1: "GPT-5.4 (Codex)",
  pass2: "MiniMax M2.5",
  pass3: "MiMo-V2-Flash",
  pass4: "Kimi K2",
  pass5: "GLM-5",
};

function formatPassNames(passes) {
  if (!Array.isArray(passes) || !passes.length) return null;
  return passes.map(p => PASS_MODEL_NAMES[p] || p).join(", ");
}

/** Split a wall-of-text summary into readable paragraphs by sentence boundaries. */
function formatSummary(text) {
  if (!text) return null;
  // If it already has paragraph breaks, respect them
  if (text.includes("\n\n")) {
    return text.split(/\n\n+/).filter(Boolean).map((p, i) => (
      <p key={i} style={{ fontSize: 13, color: C.textMid, lineHeight: 1.7, margin: "0 0 12px" }}>{p.trim()}</p>
    ));
  }
  // Otherwise split on numbered items like (1), (2), (3) or sentence-ending periods before capitals
  const parts = text.split(/(?<=\.)\s+(?=\(\d\)|[A-Z]{2,}|\d+ (?:dispute|escalation))/).filter(Boolean);
  if (parts.length <= 1) {
    // Try splitting on numbered markers
    const numbered = text.split(/(?=\(\d+\)\s)/).filter(Boolean);
    if (numbered.length > 1) {
      return (
        <>
          <p style={{ fontSize: 13, color: C.textMid, lineHeight: 1.7, margin: "0 0 12px" }}>{numbered[0].trim()}</p>
          <ol style={{ fontSize: 13, color: C.textMid, lineHeight: 1.7, margin: "0 0 12px", paddingLeft: 20 }}>
            {numbered.slice(1).map((item, i) => (
              <li key={i} style={{ marginBottom: 8 }}>{item.replace(/^\(\d+\)\s*/, "").trim()}</li>
            ))}
          </ol>
        </>
      );
    }
    return <p style={{ fontSize: 13, color: C.textMid, lineHeight: 1.7, margin: 0 }}>{text}</p>;
  }
  return parts.map((p, i) => (
    <p key={i} style={{ fontSize: 13, color: C.textMid, lineHeight: 1.7, margin: "0 0 12px" }}>{p.trim()}</p>
  ));
}

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

      {(() => {
        const agentsData = report?.agents || {};
        // Note: report.agents.<key> IS the synthesis object (see reports.js
        // readSynthesis()) \u2014 metadata lives at agentsData[k].metadata, not
        // agentsData[k].synthesis.metadata.
        const metas = ["codeAnalysis", "accessibility", "qaAnalysis"]
          .map(k => agentsData[k]?.metadata).filter(Boolean);
        const coverage = metas.find(m => m.coverage?.truncated)?.coverage;
        const partial = metas.find(m => m.partial_analysis);
        const synthFailed = metas.find(m => m.synthesis_failed);
        if (!coverage && !partial && !synthFailed) return null;
        return (
          <div className="info-banner" role="status" style={{ marginBottom: 16, borderColor: C.warning }}>
            <strong>Analysis coverage caveats</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13 }}>
              {coverage && <li>Codebase exceeded the bundle budget: {coverage.includedFiles} of {coverage.totalFiles} files ({coverage.coveragePct}%) were visible to API passes 2-5. Findings in excluded files can only come from pass 1 and cannot reach the confirmed tier.</li>}
              {partial && <li>Not all model passes completed ({partial.models_completed}/{partial.models_total}); convergence confidence is reduced.</li>}
              {synthFailed && <li>Synthesis model was unavailable; findings are a deterministic merge without dispute resolution.</li>}
            </ul>
          </div>
        );
      })()}

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
          <div className="tab-row" role="tablist" onKeyDown={e => {
              const idx = availableTabs.findIndex(t => t.key === activeTab);
              if (e.key === "ArrowRight") { e.preventDefault(); const next = availableTabs[(idx + 1) % availableTabs.length]; setActiveTab(next.key); document.getElementById(`tab-${next.key}`)?.focus(); }
              if (e.key === "ArrowLeft") { e.preventDefault(); const prev = availableTabs[(idx - 1 + availableTabs.length) % availableTabs.length]; setActiveTab(prev.key); document.getElementById(`tab-${prev.key}`)?.focus(); }
            }}>
            {availableTabs.map(tab => (
              <button key={tab.key} id={`tab-${tab.key}`} type="button" className={activeTab === tab.key ? "is-active" : ""} onClick={() => setActiveTab(tab.key)} role="tab" aria-selected={activeTab === tab.key} aria-controls={`panel-${tab.key}`} tabIndex={activeTab === tab.key ? 0 : -1}>
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
              <a key={label} className="doc-card text-link" href={fileName ? getDocDownloadUrl(runId, fileName) : getHecvatDownloadUrl(runId)} style={{ display: "block", textDecoration: "none" }} aria-label={`Download ${fileName || "HECVAT 4.15 XLSX"}`}>
                <div className="section-label">Download</div>
                <h3 style={{ marginTop: 8, fontSize: 14 }}>{label}</h3>
              </a>
            ))}
          </div>
          <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
            <div className="section-label" style={{ marginBottom: 8 }}>Export all findings</div>
            <div style={{ display: "flex", gap: 8 }}>
              <a href={getFindingsCsvUrl(runId)} className="doc-card text-link" style={{ textDecoration: "none", padding: "10px 16px", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }} aria-label="Download findings as CSV">
                CSV
              </a>
              <a href={getFindingsJsonUrl(runId)} className="doc-card text-link" style={{ textDecoration: "none", padding: "10px 16px", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }} aria-label="Download findings as JSON">
                JSON
              </a>
            </div>
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

  // Documentation agent has a different structure: { userGuide, adminGuide, complianceSummary, metadata }
  if (!findings.length && !data.summary && (data.userGuide || data.adminGuide || data.complianceSummary)) {
    const docs = [
      data.userGuide && "User Guide",
      data.adminGuide && "Admin Guide",
      data.complianceSummary && "Compliance Summary",
    ].filter(Boolean);
    return (
      <div className="section-stack">
        <div className="body-copy" style={{ marginTop: 0 }}>
          Generated {docs.length} document{docs.length !== 1 ? "s" : ""}: {docs.join(", ")}.
          {data.metadata?.todoCount > 0 && ` ${data.metadata.todoCount} TODO items need human review.`}
          {data.metadata?.filesRead > 0 && ` ${data.metadata.filesRead} source files analyzed.`}
        </div>
        <div className="muted" style={{ fontSize: 13 }}>Download generated documents from the "Generated outputs" section below.</div>
      </div>
    );
  }

  if (!findings.length && !data.summary) return <div className="muted">No findings recorded.</div>;
  return (
    <div className="section-stack">
      {data.summary && <div style={{ marginBottom: 16 }}>{formatSummary(data.summary)}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {findings.map((f, i) => {
          const sev = f.severity || f.level || "info";
          const cfg = SEVERITY_CONFIG[sev] || SEVERITY_CONFIG.info;
          const evidence = f.evidence || f.location || "";
          const category = f.category || f.wcagCriterion || "";
          const convergence = f.convergenceCount ?? f.modelAgreement;
          const reportedBy = Array.isArray(f.reportedBy) ? f.reportedBy : [];
          return (
            <div key={`${f.title || f.description}-${i}`} className="finding-card" style={{ borderColor: `${cfg.color}30`, opacity: f.priorStatus === "resolved" ? 0.55 : 1 }}>
              {/* Header row: severity + category + convergence + prior status */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                <span className="severity-pill" style={{ background: cfg.bg, color: cfg.color }}>{cfg.label || sev}</span>
                {category && (
                  <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: C.surfaceAlt, color: C.textDim,
                    fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 0.3 }}>
                    {f.wcagCriterion ? `WCAG ${f.wcagCriterion}` : category}
                  </span>
                )}
                {convergence != null && (
                  <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: C.surfaceAlt, color: C.textDim,
                    fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                    {convergence}/5 models
                  </span>
                )}
                {f.priorStatus && f.priorStatus !== "new" && (
                  <span className="soft-pill" style={{ fontSize: 10, padding: "2px 7px",
                    background: f.priorStatus === "resolved" ? C.successBg : f.priorStatus === "partial" ? C.warningBg : "transparent",
                    color: f.priorStatus === "resolved" ? C.success : f.priorStatus === "partial" ? C.warning : C.textMid, fontWeight: 700 }}>
                    {f.priorStatus === "resolved" ? "Resolved" : f.priorStatus === "partial" ? "Partial Fix" : "Still Open"}
                  </span>
                )}
              </div>
              {/* Title */}
              <strong style={{ display: "block", fontSize: 14, lineHeight: 1.4, textDecoration: f.priorStatus === "resolved" ? "line-through" : "none" }}>
                {f.title || f.description}
              </strong>
              {/* Detail */}
              {f.detail && (
                <p style={{ fontSize: 13, color: C.textMid, lineHeight: 1.65, margin: "8px 0 0", whiteSpace: "pre-line" }}>{f.detail}</p>
              )}
              {/* Evidence / file locations */}
              {evidence && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>Evidence</div>
                  <div style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: C.text, lineHeight: 1.6,
                    padding: "6px 10px", borderRadius: 6, background: C.surfaceAlt, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {evidence}
                  </div>
                </div>
              )}
              {/* Remediation */}
              {f.remediation && (
                <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 6, background: "rgba(26,107,75,0.06)", border: `1px solid rgba(26,107,75,0.15)` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.success, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>Remediation</div>
                  <p style={{ fontSize: 12, color: C.text, lineHeight: 1.55, margin: 0, whiteSpace: "pre-line" }}>{f.remediation}</p>
                </div>
              )}
              {/* Reported by models */}
              {reportedBy.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 11, color: C.textDim }}>
                  Reported by: {formatPassNames(reportedBy)}
                </div>
              )}
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
