import { useEffect, useMemo, useState, useCallback } from "react";
import { C, AGENTS, ROUTE_META } from "../constants.js";
import { Btn, ErrorBanner, PageHeader, Skeleton, StatusBadge, TrackBadge, formatDuration, relativeTime } from "./primitives.jsx";
import { usePipelineStream } from "../hooks/useSSE.js";
import { getPipelineRun, getTool, cancelPipelineRun, retryPipelineRun } from "../api.js";
import { navigate } from "../hooks/useHashRouter.js";
import Breadcrumb from "./Breadcrumb.jsx";

const PIPELINE_AGENTS = [
  { name: "Code & Security Analysis", key: "code-analysis", passes: 5 },
  { name: "Accessibility Audit", key: "accessibility", passes: 5 },
  { name: "QA / Bug Detection", key: "qa-analysis", passes: 5 },
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
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);

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
      if (event.type === "pass_retry") {
        const key = `${event.agent}_retries`;
        statuses[key] = (statuses[key] || 0) + 1;
      }
    }
    return statuses;
  }, [events]);

  const isLive = run && ["running", "queued"].includes(run.status) && !sseDone;
  const isCancelled = events.some(e => e.type === "status" && e.status === "cancelled") || run?.status === "cancelled";
  const failed = events.some(e => e.type === "status" && e.status === "failed") || run?.status === "failed";
  const completed = run?.status === "completed" || events.some(e => e.type === "status" && e.status === "completed") || (sseDone && !failed && !isCancelled);
  const canCancel = isLive && !cancelling;
  const canRetry = (failed || isCancelled) && !retrying;
  const retryCount = run?.retry_count || 0;

  const handleCancel = useCallback(async () => {
    setCancelling(true);
    try {
      await cancelPipelineRun(runId);
      setRun(prev => prev ? { ...prev, status: "cancelled" } : prev);
    } catch (err) {
      setError(err.message);
    } finally {
      setCancelling(false);
    }
  }, [runId]);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    try {
      const { run: newRun } = await retryPipelineRun(runId);
      // Navigate to the new run
      navigate(`/tool/${toolId}/pipeline/${newRun.id}`);
    } catch (err) {
      setError(err.message);
      setRetrying(false);
    }
  }, [runId, toolId]);

  const recentEvents = useMemo(() => {
    return events.slice(-8).reverse().map((event, i) => ({
      id: `${event.type}-${i}-${event.agent || ""}`,
      label: event.type === "agent_start" ? `Agent ${event.index + 1} started.`
        : event.type === "agent_complete" ? `Agent ${event.index + 1} completed${event.partial ? " (partial)" : ""}.`
        : event.type === "pass_complete" ? `${event.agent} pass completed${event.elapsed ? ` (${event.elapsed}s)` : ""}.`
        : event.type === "pass_retry" ? `${event.agent} ${event.pass} retrying (attempt ${event.attempt + 1})...`
        : event.type === "status" ? `Status: ${event.status}`
        : `${event.type} event`,
      isRetry: event.type === "pass_retry",
    }));
  }, [events]);

  if (loading) return <LoadingPipeline />;
  if (error && !run) return <div className="page is-compact"><ErrorBanner message={error} /></div>;

  const headerTitle = completed ? "Analysis complete"
    : isCancelled ? "Analysis cancelled"
    : failed ? "Analysis failed"
    : "Analysis in progress";

  return (
    <div className="page is-compact">
      <Breadcrumb items={[{ label: "Registry", path: "/" }, { label: tool?.name || "Tool", path: `/tool/${toolId}` }, { label: "Pipeline" }]} />

      <PageHeader
        eyebrow="Pipeline"
        title={headerTitle}
        subtitle={tool?.name}
      >
        {tool?.track ? <TrackBadge track={tool.track} size="lg" /> : null}
        {run ? <StatusBadge status={run.status} /> : null}
        {retryCount > 0 && <span className="soft-pill" style={{ fontSize: 11 }}>Retry #{retryCount}</span>}
      </PageHeader>

      <div className="summary-grid">
        <StatCard label="Started" value={run?.queued_at ? relativeTime(run.queued_at) : "-"} />
        <StatCard label="Elapsed" value={isLive && run?.queued_at ? <ElapsedTimer startTime={run.queued_at} /> : (run?.queued_at && run?.completed_at ? formatDuration(run.queued_at, run.completed_at) : "-")} />
        <StatCard label="Agents" value={PIPELINE_AGENTS.length} />
        <StatCard label="Events" value={events.length} />
      </div>

      {error && <ErrorBanner message={error} />}
      {connectionLost && <div role="alert" className="error-banner"><div><strong>Connection lost.</strong> Refresh to check status.</div></div>}
      {isLive && !cancelling && <div role="status" className="status-banner"><div><strong>Safe to leave.</strong> The pipeline continues server-side.</div></div>}
      {cancelling && <div role="status" className="status-banner"><div><strong>Cancelling pipeline...</strong> Killing active processes.</div></div>}

      {isCancelled && (
        <div role="alert" className="error-banner" style={{ background: "var(--warning-bg)", borderColor: "var(--warning)" }}>
          <div><strong>Pipeline cancelled.</strong> No API charges for unstarted passes.</div>
          <div style={{ display: "flex", gap: 8 }}>
            {canRetry && <Btn onClick={handleRetry} disabled={retrying}>{retrying ? "Retrying..." : "Retry run"}</Btn>}
            <Btn variant="ghost" onClick={() => navigate(`/tool/${toolId}`)}>Back to tool</Btn>
          </div>
        </div>
      )}

      {failed && !isCancelled && (
        <div role="alert" className="error-banner">
          <div>
            <strong>Pipeline failed.</strong> {run?.error_message || "Check logs for details."}
            {retryCount >= 2 && <div style={{ marginTop: 4, fontSize: 12, color: C.textDim }}>Max retries reached. Investigate the issue before retrying.</div>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {canRetry && retryCount < 2 && <Btn onClick={handleRetry} disabled={retrying}>{retrying ? "Retrying..." : "Retry run"}</Btn>}
            <Btn variant="ghost" onClick={() => navigate(`/tool/${toolId}`)}>Back to tool</Btn>
          </div>
        </div>
      )}

      <div className="report-grid">
        <section className="section-card" aria-live="polite" aria-atomic="false">
          <div className="card-header"><div><h2>Agent progress</h2></div></div>
          <div className="data-list">
            {PIPELINE_AGENTS.map((agent, index) => {
              const isDone = agentStatuses[index] === "done" || (completed && !isLive);
              const isRunning = agentStatuses[index] === "running" && isLive;
              const passes = agentStatuses[`${agent.key}_passes`] || (isDone ? agent.passes : 0);
              const retries = agentStatuses[`${agent.key}_retries`] || 0;
              const isFailed = (failed || isCancelled) && !isDone && agentStatuses[index] === "running";
              return (
                <div key={agent.name} className="data-row">
                  <div className="inline-meta">
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="soft-pill">Agent {index + 1}</span>
                      <strong>{agent.name}</strong>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {retries > 0 && <span className="soft-pill" style={{ fontSize: 10, color: C.warning }}>↻{retries} retries</span>}
                      <span className={`soft-pill ${isRunning ? "pulse" : ""}`} style={isFailed ? { color: C.danger } : {}}>
                        {isDone ? "Done" : isFailed ? (isCancelled ? "Cancelled" : "Failed") : isRunning ? "Running" : "Waiting"}
                      </span>
                    </div>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <div className="inline-meta" style={{ marginBottom: 6 }}>
                      <span className="section-label">Passes</span>
                      <span className="mono" style={{ fontSize: 12 }}>{passes}/{agent.passes}</span>
                    </div>
                    <div className="score-bar" role="progressbar" aria-valuenow={Math.round((passes / agent.passes) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${agent.name} progress`}>
                      <div className="score-bar-fill" style={{
                        width: `${(passes / agent.passes) * 100}%`,
                        background: isDone ? C.success : isFailed ? C.danger : C.accent,
                      }} />
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
              {recentEvents.map(e => (
                <div key={e.id} className="event-card">
                  <div style={{ fontSize: 13, color: e.isRetry ? C.warning : undefined }}>{e.label}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="page-actions">
        {canCancel && (
          <Btn
            variant="ghost"
            onClick={handleCancel}
            disabled={cancelling}
            style={{ color: C.danger, borderColor: C.danger }}
          >
            {cancelling ? "Cancelling..." : "Cancel pipeline"}
          </Btn>
        )}
        <Btn variant="ghost" onClick={() => navigate(`/tool/${toolId}`)}>Back to tool</Btn>
        {completed && !failed && !isCancelled ? <Btn onClick={() => navigate(`/tool/${toolId}/report/${runId}`)}>Open report</Btn> : null}
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
