import { useEffect, useMemo, useState } from "react";
import { C, AGENTS, ROUTE_META } from "../constants.js";
import { Btn, ErrorBanner, PageHeader, Skeleton, StatusBadge, TrackBadge, formatDuration, relativeTime } from "./primitives.jsx";
import { usePipelineStream } from "../hooks/useSSE.js";
import { getPipelineRun, getTool } from "../api.js";
import { navigate } from "../hooks/useHashRouter.js";
import Breadcrumb from "./Breadcrumb.jsx";

const PIPELINE_AGENTS = [
  { name: "Code & Security Analysis", key: "code-analysis", passes: 5 },
  { name: "Accessibility Audit", key: "accessibility", passes: 5 },
  { name: "HECVAT 4 Lite", key: "hecvat", passes: 1 },
  { name: "Documentation Generation", key: "documentation", passes: 1 },
];

function ElapsedTimer({ startTime }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startTime) return;
    const start = new Date(startTime).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTime]);
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;
  return <span className="mono">{min}:{String(sec).padStart(2, "0")}</span>;
}

export default function Pipeline({ toolId, runId }) {
  const [tool, setTool] = useState(null);
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const { events, done: sseDone, connectionLost } = usePipelineStream(
    run?.status === "running" || run?.status === "queued" ? runId : null
  );

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([getTool(toolId), getPipelineRun(runId)])
      .then(([toolData, runData]) => { setTool(toolData.tool); setRun(runData.run || runData); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [toolId, runId]);

  const agentStatuses = useMemo(() => {
    const statuses = {};
    for (const event of events) {
      if (event.type === "agent_start") statuses[event.index] = "running";
      if (event.type === "agent_complete") statuses[event.index] = "done";
      if (event.type === "pass_complete") {
        const key = `${event.agent}_passes`;
        statuses[key] = (statuses[key] || 0) + 1;
      }
    }
    return statuses;
  }, [events]);

  const isLive = run && ["running", "queued"].includes(run.status) && !sseDone;
  const failed = events.some(e => e.type === "status" && e.status === "failed") || run?.status === "failed";
  const completed = run?.status === "completed" || events.some(e => e.type === "status" && e.status === "completed") || sseDone;

  const recentEvents = useMemo(() => {
    return events.slice(-8).reverse().map((event, i) => ({
      id: `${event.type}-${i}-${event.agent || ""}`,
      label: event.type === "agent_start" ? `Agent ${event.index + 1} started.`
        : event.type === "agent_complete" ? `Agent ${event.index + 1} completed.`
        : event.type === "pass_complete" ? `${event.agent} pass completed.`
        : event.type === "status" ? `Status: ${event.status}`
        : `${event.type} event`,
    }));
  }, [events]);

  if (loading) return <LoadingPipeline />;
  if (error) return <div className="page is-compact"><ErrorBanner message={error} /></div>;

  return (
    <div className="page is-compact">
      <Breadcrumb items={[{ label: "Registry", path: "/" }, { label: tool?.name || "Tool", path: `/tool/${toolId}` }, { label: "Pipeline" }]} />

      <PageHeader
        eyebrow="Pipeline"
        title={completed ? "Analysis complete" : failed ? "Analysis failed" : "Analysis in progress"}
        subtitle={tool?.name}
      >
        {tool?.track ? <TrackBadge track={tool.track} size="lg" /> : null}
        {run ? <StatusBadge status={run.status} /> : null}
      </PageHeader>

      <div className="summary-grid">
        <StatCard label="Started" value={run?.queued_at ? relativeTime(run.queued_at) : "-"} />
        <StatCard label="Elapsed" value={isLive && run?.queued_at ? <ElapsedTimer startTime={run.queued_at} /> : (run?.queued_at && run?.completed_at ? formatDuration(run.queued_at, run.completed_at) : "-")} />
        <StatCard label="Agents" value={PIPELINE_AGENTS.length} />
        <StatCard label="Events" value={events.length} />
      </div>

      {connectionLost && <div className="error-banner"><div><strong>Connection lost.</strong> Refresh to check status.</div></div>}
      {isLive && <div className="status-banner"><div><strong>Safe to leave.</strong> The pipeline continues server-side.</div></div>}
      {failed && <div className="error-banner"><div><strong>Pipeline failed.</strong> Check logs or retry.</div><Btn variant="ghost" onClick={() => navigate(`/tool/${toolId}`)}>Back to tool</Btn></div>}

      <div className="report-grid">
        <section className="section-card" aria-live="polite" aria-atomic="false">
          <div className="card-header"><div><h2>Agent progress</h2></div></div>
          <div className="data-list">
            {PIPELINE_AGENTS.map((agent, index) => {
              const isDone = agentStatuses[index] === "done" || (completed && !isLive);
              const isRunning = agentStatuses[index] === "running" && isLive;
              const passes = agentStatuses[`${agent.key}_passes`] || (isDone ? agent.passes : 0);
              return (
                <div key={agent.name} className="data-row">
                  <div className="inline-meta">
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="soft-pill">Agent {index + 1}</span>
                      <strong>{agent.name}</strong>
                    </div>
                    <span className={`soft-pill ${isRunning ? "pulse" : ""}`}>{isDone ? "Done" : isRunning ? "Running" : "Waiting"}</span>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <div className="inline-meta" style={{ marginBottom: 6 }}>
                      <span className="section-label">Passes</span>
                      <span className="mono" style={{ fontSize: 12 }}>{passes}/{agent.passes}</span>
                    </div>
                    <div className="score-bar">
                      <div className="score-bar-fill" style={{ width: `${(passes / agent.passes) * 100}%`, background: isDone ? C.success : C.accent }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="section-card">
          <div className="card-header"><div><h2>Recent activity</h2></div></div>
          {recentEvents.length === 0 ? (
            <div className="muted">{completed ? "Pipeline completed." : "Waiting for events."}</div>
          ) : (
            <div className="data-list">
              {recentEvents.map(e => <div key={e.id} className="event-card"><div style={{ fontSize: 13 }}>{e.label}</div></div>)}
            </div>
          )}
        </section>
      </div>

      <div className="page-actions">
        <Btn variant="ghost" onClick={() => navigate(`/tool/${toolId}`)}>Back to tool</Btn>
        {completed && !failed ? <Btn onClick={() => navigate(`/tool/${toolId}/report/${runId}`)}>Open report</Btn> : null}
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return <div className="metric-card"><div className="section-label">{label}</div><div className="metric-card-value">{value}</div></div>;
}

function LoadingPipeline() {
  return (
    <div className="page is-compact">
      <Skeleton width={160} height={16} />
      <Skeleton width="60%" height={40} />
      <div className="summary-grid">{[1,2,3,4].map(i => <Skeleton key={i} height={100} />)}</div>
    </div>
  );
}
