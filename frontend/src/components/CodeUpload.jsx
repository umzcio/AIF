import { useState, useEffect, useCallback, useRef } from "react";
import { Shield, Eye, ClipboardCheck, FileText, Upload, Package, Check, Clock, ArrowRight, Terminal, Zap } from "lucide-react";
import { C, TRACK_COLORS } from "../constants.js";
import { navigate } from "../hooks/useHashRouter.js";
import { getTool, startPipelineRun, getPipelineRun, uploadCodebase, cancelPipelineRun } from "../api.js";
import { usePipelineStream } from "../hooks/useSSE.js";
import { useToast } from "./Toast.jsx";
import { TrackBadge, Skeleton, ErrorBanner } from "./primitives.jsx";
import { SEV, AGENT_INDEX_MAP, AGENT_ID_MAP } from "./findings/utils.js";

// ═══════════════════════════════════════════════════════════
// AGENT DEFINITIONS
// ═══════════════════════════════════════════════════════════

const AGENTS = [
  { id: "security", name: "Code / Security", Icon: Shield, color: "#A34414",
    desc: "Static analysis, dependency audit, secrets scan, OWASP checks",
    phases: ["Unpacking archive", "Scanning dependencies", "Static analysis", "Secrets detection", "OWASP rule check", "Generating report"] },
  { id: "accessibility", name: "Accessibility", Icon: Eye, color: "#7C3AED",
    desc: "WCAG 2.2 AA compliance, Section 508, screen reader compatibility",
    phases: ["Parsing HTML/JSX templates", "Color contrast analysis", "ARIA attribute check", "Keyboard navigation audit", "Screen reader simulation", "Generating report"] },
  { id: "qa", name: "QA / Bug Detection", Icon: ClipboardCheck, color: "#0891B2",
    desc: "Logic bugs, error handling, async issues, edge cases, failure modes",
    phases: ["Analyzing control flow", "Checking error paths", "Async/concurrency audit", "Edge case detection", "State management review", "Generating report"] },
  { id: "documentation", name: "Documentation", Icon: FileText, color: "#16864E",
    desc: "Auto-generate user guide, admin guide, findings report, and HECVAT assessment",
    phases: ["Analyzing codebase structure", "Extracting API surface", "Writing user guide", "Writing admin guide", "HECVAT assessment", "Final review"] },
];

// ═══════════════════════════════════════════════════════════
// AGENT LOG PANEL
// ═══════════════════════════════════════════════════════════

function AgentLogPanel({ agent, logs, isRunning }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [logs]);
  return (
    <div style={{ borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border}`, background: C.surface, minWidth: 0 }}>
      <div style={{ padding: "8px 12px", background: C.surfaceAlt, display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${C.border}` }}>
        <Terminal size={12} color={C.textDim} />
        <span style={{ fontSize: 11, color: C.textMid, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{agent.name} Agent</span>
        {isRunning && <span style={{ width: 6, height: 6, borderRadius: "50%", background: TRACK_COLORS[1], animation: "pulse 1.5s infinite" }} />}
      </div>
      <div ref={ref} style={{ padding: "8px 12px", maxHeight: 280, overflowY: "auto", overflowX: "hidden", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.7 }}>
        {logs.length === 0 && !isRunning && <div style={{ color: C.textDim }}>Waiting for agent to start...</div>}
        {logs.map((log, i) => {
          const isCrit = log.includes("CRITICAL") || log.includes("critical");
          const isWarn = log.includes("WARN") || log.includes("HIGH") || log.includes("high");
          const isFail = log.includes("FAIL") || log.includes("error");
          const isPass = log.includes("PASS") || log.includes("complete") || log.includes("done");
          const color = isCrit ? SEV.critical.color : (isWarn || isFail) ? SEV.high.color : isPass ? TRACK_COLORS[1] : C.textMid;
          return <div key={i} style={{ color, overflowWrap: "anywhere" }}>{log}</div>;
        })}
        {isRunning && <div style={{ color: C.textDim }}>█</div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT — Upload + Running phases only
// ═══════════════════════════════════════════════════════════

export default function CodeUpload({ toolId, user }) {
  const { toast } = useToast();
  const [tool, setTool] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [file, setFile] = useState(null);
  const [runId, setRunId] = useState(null);
  const [hasCompletedRun, setHasCompletedRun] = useState(false);
  const [starting, setStarting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);

  // Phase: upload | running
  const [phase, setPhase] = useState("upload");
  const [agentStates, setAgentStates] = useState({ security: "idle", accessibility: "idle", qa: "idle", documentation: "idle" });
  const [agentProgress, setAgentProgress] = useState({ security: 0, accessibility: 0, qa: 0, documentation: 0 });
  const [agentLogs, setAgentLogs] = useState({ security: [], accessibility: [], qa: [], documentation: [] });
  const [expandedAgent, setExpandedAgent] = useState("security");

  // Layer 0 tool tracking
  const [toolStates, setToolStates] = useState({});
  // { "semgrep": { status: "running"|"complete"|"skipped", elapsed, findings } }

  // Queue position
  const [queuePosition, setQueuePosition] = useState(null);

  // Cancel
  const [cancelling, setCancelling] = useState(false);

  // SSE
  const { events, done: sseDone, failed: sseFailed, connectionLost, onPassLog } = usePipelineStream(runId);
  const [pipelineError, setPipelineError] = useState(null);

  // Load tool and check for active pipeline runs
  useEffect(() => {
    setLoading(true);
    getTool(toolId)
      .then(data => {
        setTool(data.tool);
        const runs = data.runs || [];
        setHasCompletedRun(runs.some(r => r.status === "completed"));
        const activeRun = runs.find(r => r.status === "running" || r.status === "queued");
        if (activeRun) {
          setRunId(activeRun.id);
          setPhase("running");
          // Restore agent states from DB
          getPipelineRun(activeRun.id).then(runData => {
            if (runData.agents) {
              for (const agent of runData.agents) {
                const agentId = AGENT_ID_MAP[agent.agent_name] || agent.agent_name;
                if (agent.status === "completed") {
                  setAgentStates(p => ({ ...p, [agentId]: "complete" }));
                  setAgentProgress(p => ({ ...p, [agentId]: 1 }));
                } else if (agent.status === "running") {
                  setAgentStates(p => ({ ...p, [agentId]: "running" }));
                  const pct = agent.passes_total > 0 ? agent.passes_completed / agent.passes_total : 0;
                  setAgentProgress(p => ({ ...p, [agentId]: pct }));
                  setExpandedAgent(agentId);
                }
              }
            }
            const curIdx = runData.run?.current_agent_index;
            if (curIdx != null) {
              const curAgentId = AGENT_INDEX_MAP[curIdx];
              if (curAgentId) {
                setAgentStates(p => p[curAgentId] === "idle" ? { ...p, [curAgentId]: "running" } : p);
              }
            }
          }).catch(() => {});
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [toolId]);

  // Subscribe to live pass_log events
  const MAX_LOG_LINES = 200;
  useEffect(() => {
    onPassLog((event) => {
      const agentId = AGENT_ID_MAP[event.agent] || event.agent;
      if (!agentId || !event.lines) return;
      const prefix = event.model ? `[${event.model}]` : `[${event.pass}]`;
      const newLines = event.lines.map(l => `${prefix} ${l}`);
      setAgentLogs(p => {
        const existing = p[agentId] || [];
        const combined = [...existing, ...newLines];
        return { ...p, [agentId]: combined.length > MAX_LOG_LINES ? combined.slice(-MAX_LOG_LINES) : combined };
      });
    });
  }, [onPassLog]);

  // Process SSE events
  const processedRef = useRef(0);
  useEffect(() => {
    for (let i = processedRef.current; i < events.length; i++) {
      const event = events[i];
      if (event.type === "state") {
        setQueuePosition(event.queuePosition || null);
        // Restore tool states from catch-up
        if (event.toolStates) {
          setToolStates(p => {
            const next = { ...p };
            for (const [name, t] of Object.entries(event.toolStates)) {
              if (!next[name] || next[name].status === "running") {
                next[name] = t;
              }
            }
            return next;
          });
        }
      }
      if (event.type === "state" && event.agents) {
        for (const agent of event.agents) {
          const agentId = AGENT_ID_MAP[agent.agent_name] || agent.agent_name;
          if (agent.status === "completed") {
            setAgentStates(p => ({ ...p, [agentId]: "complete" }));
            setAgentProgress(p => ({ ...p, [agentId]: 1 }));
          } else if (agent.status === "running") {
            setAgentStates(p => ({ ...p, [agentId]: "running" }));
            const pct = agent.passes_total > 0 ? agent.passes_completed / agent.passes_total : 0;
            setAgentProgress(p => ({ ...p, [agentId]: pct }));
            setExpandedAgent(agentId);
          }
        }
        const curIdx = event.run?.current_agent_index;
        if (curIdx != null) {
          const curAgentId = AGENT_INDEX_MAP[curIdx];
          if (curAgentId) {
            setAgentStates(p => p[curAgentId] === "idle" ? { ...p, [curAgentId]: "running" } : p);
          }
        }
      }
      if (event.type === "status" && event.status === "running") {
        setQueuePosition(null);
      }
      if (event.type === "agent_start") {
        const agentId = AGENT_INDEX_MAP[event.index];
        if (agentId) {
          setAgentStates(p => ({ ...p, [agentId]: "running" }));
          setExpandedAgent(agentId);
          setAgentLogs(p => ({ ...p, [agentId]: [...p[agentId], `[start] ${AGENTS.find(a => a.id === agentId)?.name || agentId} agent started...`] }));
        }
      }
      if (event.type === "agent_complete") {
        const agentId = AGENT_INDEX_MAP[event.index];
        if (agentId) {
          setAgentStates(p => ({ ...p, [agentId]: "complete" }));
          setAgentProgress(p => ({ ...p, [agentId]: 1 }));
          const logs = [];
          if (event.passes != null) logs.push(`[done] ${event.passes} model passes completed${event.failures ? `, ${event.failures} failed` : ""}`);
          const s = event.summary;
          if (s && s.total != null && s.critical != null) {
            const parts = [];
            if (s.critical) parts.push(`${s.critical} critical`);
            if (s.high) parts.push(`${s.high} high`);
            if (s.warning) parts.push(`${s.warning} warning`);
            if (s.medium) parts.push(`${s.medium} medium`);
            if (s.low) parts.push(`${s.low} low`);
            if (s.info) parts.push(`${s.info} info`);
            logs.push(`[result] ${s.total} findings: ${parts.join(", ") || "none"}`);
            if (s.topFindings) for (const f of s.topFindings.slice(0, 3)) {
              logs.push(`  ${(f.severity || "").toUpperCase()}: ${f.title}`);
            }
          } else if (s && s.docs) {
            logs.push(`[result] Generated: ${s.docs.join(", ")}`);
            if (s.hecvat) logs.push(`[result] HECVAT assessment generated`);
            if (s.todoCount > 0) logs.push(`  ${s.todoCount} TODO items need human review`);
          } else {
            logs.push(`[done] Analysis complete.`);
          }
          setAgentLogs(p => ({ ...p, [agentId]: [...p[agentId], ...logs] }));
        }
      }
      if (event.type === "pass_complete") {
        const agentId = AGENT_ID_MAP[event.agent] || event.agent;
        if (agentId) {
          const maxPasses = (agentId === "security" || agentId === "accessibility" || agentId === "qa") ? 5 : 1;
          setAgentProgress(p => ({ ...p, [agentId]: Math.min((p[agentId] || 0) + 1 / maxPasses, 0.95) }));
          const model = event.model || `Pass ${event.pass || ""}`;
          const elapsed = event.elapsed ? ` (${event.elapsed}s)` : "";
          setAgentLogs(p => ({ ...p, [agentId]: [...p[agentId], `[pass] ${model} complete${elapsed}`] }));
        }
      }
      if (event.type === "log" && event.agent) {
        const agentId = AGENT_ID_MAP[event.agent] || event.agent;
        if (agentId) {
          setAgentLogs(p => ({ ...p, [agentId]: [...p[agentId], event.message || event.data || String(event)] }));
        }
      }
      if (event.type === "tool_start") {
        setToolStates(p => ({ ...p, [event.tool]: { status: "running", target: event.target } }));
      }
      if (event.type === "tool_complete") {
        setToolStates(p => ({ ...p, [event.tool]: {
          status: event.skipped ? "skipped" : "complete",
          target: event.target,
          elapsed: event.elapsed,
          findings: event.findings || 0,
          error: event.error,
        }}));
      }
      if (event.type === "tools_summary" && event.tools) {
        // Catch-up for tools whose individual events were missed (SSE connected late)
        setToolStates(p => {
          const next = { ...p };
          for (const [name, t] of Object.entries(event.tools)) {
            if (!next[name] || next[name].status === "running") {
              next[name] = { status: t.status, findings: t.findings || 0 };
            }
          }
          return next;
        });
      }
    }
    processedRef.current = events.length;
  }, [events]);

  // Handle pipeline failure
  useEffect(() => {
    if (phase === "running" && sseFailed) {
      const failEvent = events.findLast(e => e.type === "status" && e.status === "failed");
      const stateEvent = events.findLast(e => e.type === "state");
      const errorMsg = failEvent?.error || stateEvent?.run?.error_message || "Pipeline failed";
      setPipelineError(errorMsg);
      // Refresh completed run state
      getTool(toolId).then(data => {
        setHasCompletedRun((data.runs || []).some(r => r.status === "completed"));
      }).catch(() => {});
    }
  }, [phase, sseFailed, events]);

  // Pipeline completes → navigate to findings review
  useEffect(() => {
    if (phase === "running" && sseDone && !sseFailed) {
      setAgentStates({ security: "complete", accessibility: "complete", qa: "complete", documentation: "complete" });
      setAgentProgress({ security: 1, accessibility: 1, qa: 1, documentation: 1 });
      // Brief delay so the user sees 100% before navigating
      setTimeout(() => {
        navigate(`/review/${toolId}/${runId}`);
      }, 800);
    }
  }, [phase, sseDone, sseFailed, runId, toolId]);

  const handleFile = useCallback(e => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (f) setFile(f);
  }, []);

  async function handleStart() {
    if (!file) { toast.error("Please select a file first"); return; }
    setStarting(true);
    setUploadProgress({ loaded: 0, total: file.size });
    try {
      await uploadCodebase(toolId, file, setUploadProgress);
      setUploadProgress(null);
      const result = await startPipelineRun(toolId, "direct-api");
      setRunId(result.run.id);
      setPhase("running");
      toast.success("Pipeline started");
    } catch (err) {
      toast.error(err.message);
      setUploadProgress(null);
      setStarting(false);
    }
  }

  function resetToUpload() {
    setPipelineError(null);
    setRunId(null);
    setPhase("upload");
    setFile(null);
    setStarting(false);
    setUploadProgress(null);
    setAgentStates({ security: "idle", accessibility: "idle", qa: "idle", documentation: "idle" });
    setAgentProgress({ security: 0, accessibility: 0, qa: 0, documentation: 0 });
    setAgentLogs({ security: [], accessibility: [], qa: [], documentation: [] });
    setToolStates({});
  }

  if (loading) return <div style={{ padding: 24 }}><Skeleton height={200} /></div>;
  if (error) return <div style={{ padding: 24 }}><ErrorBanner message={error} /></div>;

  return (
    <div>
      {/* Status bar when running */}
      {phase === "running" && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{tool?.name || "Tool"}</div>
            {tool?.track && <TrackBadge track={tool.track} />}
          </div>
        </div>
      )}

      {/* ── PHASE: UPLOAD ── */}
      {phase === "upload" && (
        <div style={{ maxWidth: 640, margin: "48px auto" }}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px" }}>Upload Your Code</h1>
            <p style={{ fontSize: 14, color: C.textMid, margin: 0 }}>Submit your codebase as a .zip archive. Deterministic scanners and four AI agents will review it.</p>
          </div>

          <label htmlFor="zipInput" onDragOver={e => e.preventDefault()} onDrop={handleFile}
            style={{ display: "block", padding: 56, borderRadius: 12, border: `2px dashed ${file ? C.accent : C.border}`,
              background: file ? C.accentSoft : C.surface, textAlign: "center", cursor: "pointer", transition: "all .2s", marginBottom: 24 }}>
            <input id="zipInput" type="file" accept=".zip" aria-label="Upload ZIP archive"
              style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}
              onChange={handleFile} />
            <div style={{ marginBottom: 14, display: "flex", justifyContent: "center" }}>
              {file ? <Package size={40} color={C.accent} /> : <Upload size={40} color={C.textDim} />}
            </div>
            {file ? (
              <>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{file.name}</div>
                <div style={{ fontSize: 13, color: C.textMid, marginTop: 4 }}>{(file.size / 1024).toFixed(1)} KB — ready for review</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Drop your .zip file here</div>
                <div style={{ fontSize: 13, color: C.textMid, marginTop: 4 }}>or click to browse</div>
              </>
            )}
          </label>

          {/* Agent preview */}
          <div className="responsive-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 28 }}>
            {AGENTS.map(a => (
              <div key={a.id} style={{ padding: 14, borderRadius: 8, background: C.surface, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", background: `${a.color}12` }}>
                  <a.Icon size={16} color={a.color} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: C.textMid }}>{a.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            {file && uploadProgress && (
              <div role="status" aria-live="polite" style={{ width: "100%", maxWidth: 400 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13, color: C.textMid }}>
                  <span>Uploading...</span>
                  <span>{Math.round(uploadProgress.loaded / 1024)} / {Math.round(uploadProgress.total / 1024)} KB</span>
                </div>
                <div style={{ width: "100%", height: 8, borderRadius: 4, background: C.border, overflow: "hidden" }}
                  role="progressbar" aria-valuenow={Math.round((uploadProgress.loaded / uploadProgress.total) * 100)}
                  aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
                  <div style={{ height: "100%", borderRadius: 4, background: `linear-gradient(90deg, ${C.accent}, ${C.accentHover})`,
                    width: `${Math.min(100, (uploadProgress.loaded / uploadProgress.total) * 100)}%`, transition: "width 0.15s ease" }} />
                </div>
                <div style={{ fontSize: 12, color: C.textDim, marginTop: 4 }}>
                  {Math.round((uploadProgress.loaded / uploadProgress.total) * 100)}%
                </div>
              </div>
            )}
            {file && !uploadProgress && (
              <button onClick={handleStart} disabled={starting}
                style={{ padding: "14px 36px", borderRadius: 10, border: "none", cursor: starting ? "default" : "pointer",
                  background: `linear-gradient(135deg, ${C.accent}, ${C.accentHover})`, color: "#fff", fontSize: 15, fontWeight: 700,
                  fontFamily: "'DM Sans', sans-serif", boxShadow: `0 4px 24px ${C.accent30}`,
                  display: "inline-flex", alignItems: "center", gap: 8, opacity: starting ? 0.7 : 1 }}>
                {starting ? "Starting pipeline..." : <>Initiate Review Pipeline <ArrowRight size={16} /></>}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── PHASE: RUNNING ── */}
      {phase === "running" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
            <Clock size={16} color={C.accent} />
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Review in Progress</h2>
            <span style={{ fontSize: 12, color: C.textMid }}>
              {Object.values(agentStates).filter(s => s === "complete").length} / {AGENTS.length} agents complete
            </span>
          </div>

          {queuePosition != null && (
            <div role="status" aria-live="polite" className="info-banner" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
              <Clock size={18} color={C.accent} />
              <div>
                <strong>Your job is #{queuePosition} in the queue.</strong>
                <div style={{ fontSize: 12, color: C.textMid, marginTop: 2 }}>
                  {queuePosition === 1
                    ? "You're up next — it will start as soon as the current run finishes."
                    : `There ${queuePosition - 1 === 1 ? "is 1 job" : `are ${queuePosition - 1} jobs`} ahead of yours. You can leave this page and come back anytime.`}
                </div>
              </div>
            </div>
          )}

          {pipelineError && (
            <div role="alert" style={{ padding: "14px 16px", borderRadius: 8, background: "rgba(201,48,44,0.07)", border: `1px solid rgba(201,48,44,0.2)`, marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: TRACK_COLORS[4], marginBottom: 4 }}>Pipeline Failed</div>
              <div style={{ fontSize: 13, color: C.text, marginBottom: 10 }}>{pipelineError}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={resetToUpload}
                  style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent",
                    cursor: "pointer", fontSize: 13, fontWeight: 600, color: C.text, fontFamily: "'DM Sans', sans-serif" }}>
                  Back to Upload
                </button>
                {hasCompletedRun && (
                  <button onClick={() => navigate(`/review/${toolId}`)}
                    style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${C.accent}`, background: C.accentSoft,
                      cursor: "pointer", fontSize: 13, fontWeight: 600, color: C.accent, fontFamily: "'DM Sans', sans-serif" }}>
                    View Previous Findings
                  </button>
                )}
              </div>
            </div>
          )}
          {connectionLost && !pipelineError && (
            <div role="alert" style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(201,48,44,0.07)", border: `1px solid rgba(201,48,44,0.2)`, marginBottom: 16, fontSize: 13, color: TRACK_COLORS[4] }}>
              Connection lost. The pipeline continues server-side — refresh to check status.
            </div>
          )}

          {/* Layer 0: Deterministic Tooling status */}
          {Object.keys(toolStates).length > 0 && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: C.surfaceAlt, border: `1px solid ${C.border}`,
              marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Zap size={12} color={C.accent} />
                <span style={{ fontSize: 11, fontWeight: 700, color: C.textDim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 0.5 }}>LAYER 0</span>
              </div>
              {Object.entries(toolStates).map(([name, t]) => (
                <div key={name} style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 5,
                  background: C.surface, border: `1px solid ${C.border}`, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                  {t.status === "running" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.accent, animation: "pulse 1.5s infinite" }} />}
                  {t.status === "complete" && <Check size={11} color={TRACK_COLORS[1]} />}
                  {t.status === "skipped" && <span style={{ color: C.textDim }}>—</span>}
                  <span style={{ color: t.status === "skipped" ? C.textDim : C.text, fontWeight: 600 }}>{name}</span>
                  {t.status === "complete" && t.findings > 0 && (
                    <span style={{ color: "#A34414", fontWeight: 700 }}>{t.findings}</span>
                  )}
                  {t.status === "complete" && t.findings === 0 && (
                    <span style={{ color: TRACK_COLORS[1] }}>clean</span>
                  )}
                  {t.status === "skipped" && <span style={{ color: C.textDim, fontSize: 10 }}>n/a</span>}
                  {t.elapsed != null && t.status !== "running" && (
                    <span style={{ color: C.textDim, fontSize: 10 }}>{t.elapsed}s</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="responsive-pipeline-layout" style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr)", gap: 16 }}>
            {/* Agent sidebar */}
            <div>
              {AGENTS.map(agent => {
                const state = agentStates[agent.id];
                const progress = agentProgress[agent.id];
                const phaseIdx = Math.min(Math.floor(progress * agent.phases.length), agent.phases.length - 1);
                const phaseLabel = agent.phases[phaseIdx];
                const isActive = expandedAgent === agent.id;
                return (
                  <button type="button" key={agent.id} onClick={() => setExpandedAgent(agent.id)}
                    aria-pressed={isActive}
                    style={{ padding: 14, borderRadius: 10, background: isActive ? C.surface : "transparent", width: "100%", textAlign: "left",
                      border: `1px solid ${isActive ? agent.color + "40" : C.border}`, marginBottom: 8, cursor: "pointer", transition: "all .15s", fontFamily: "'DM Sans', sans-serif" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", background: `${agent.color}12` }}>
                        <agent.Icon size={16} color={agent.color} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{agent.name}</div>
                        <div style={{ fontSize: 10, color: C.textMid, fontFamily: "'JetBrains Mono', monospace" }}>
                          {state === "idle" ? "Queued" : state === "running" ? phaseLabel : "Complete"}
                        </div>
                      </div>
                      {state === "complete" ? <Check size={16} color={TRACK_COLORS[1]} /> :
                       state === "running" ? <span style={{ fontSize: 11, fontWeight: 700, color: agent.color, fontFamily: "'JetBrains Mono', monospace" }}>{Math.round(progress * 100)}%</span> : null}
                    </div>
                    <div style={{ height: 3, borderRadius: 2, background: C.border, overflow: "hidden" }}
                      role="progressbar" aria-valuenow={Math.round(progress * 100)}
                      aria-valuemin={0} aria-valuemax={100} aria-label={`${agent.name} progress`}>
                      <div style={{ height: "100%", width: `${progress * 100}%`, borderRadius: 2,
                        background: state === "complete" ? TRACK_COLORS[1] : agent.color, transition: "width .1s linear" }} />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Live log panel */}
            <div>
              {AGENTS.filter(a => a.id === expandedAgent).map(agent => (
                <AgentLogPanel key={agent.id} agent={agent} logs={agentLogs[agent.id]} isRunning={agentStates[agent.id] === "running"} />
              ))}
            </div>
          </div>

          {/* Cancel button */}
          {!pipelineError && (
            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={async () => {
                  if (!runId || cancelling) return;
                  setCancelling(true);
                  try {
                    await cancelPipelineRun(runId);
                    setPipelineError("Pipeline cancelled by user.");
                  } catch (err) {
                    setPipelineError(`Cancel failed: ${err.message}`);
                  } finally {
                    setCancelling(false);
                  }
                }}
                disabled={cancelling}
                style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${C.danger}`, background: "transparent",
                  cursor: cancelling ? "default" : "pointer", fontSize: 13, fontWeight: 600, color: C.danger,
                  fontFamily: "'DM Sans', sans-serif", opacity: cancelling ? 0.6 : 1, transition: "opacity .15s" }}>
                {cancelling ? "Cancelling..." : "Cancel pipeline"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
