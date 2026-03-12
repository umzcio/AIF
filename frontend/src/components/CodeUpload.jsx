import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Shield, Eye, ClipboardCheck, FileText, Upload, Package, Check, ChevronRight, ChevronDown, Clock, FileCode, Folder, FolderOpen, ArrowRight, Terminal, CheckCircle, XCircle, MinusCircle } from "lucide-react";
import { C, SEVERITY_CONFIG, TRACK_COLORS } from "../constants.js";
import { navigate } from "../hooks/useHashRouter.js";
import { getTool, startPipelineRun, getReport, getPipelineRun, updateToolStatus, uploadCodebase, cancelPipelineRun, getFindingsCsvUrl, getFindingsJsonUrl } from "../api.js";
import { usePipelineStream } from "../hooks/useSSE.js";
import { useToast } from "./Toast.jsx";
import { TrackBadge, Skeleton, ErrorBanner, relativeTime } from "./primitives.jsx";

// ═══════════════════════════════════════════════════════════
// AGENT DEFINITIONS
// ═══════════════════════════════════════════════════════════

const SEV = {
  critical: { color: "#C9302C", bg: "rgba(201,48,44,0.07)", label: "CRITICAL", order: 0 },
  high:     { color: "#A34414", bg: "rgba(163,68,20,0.07)", label: "HIGH", order: 1 },
  warning:  { color: "#7A5A07", bg: "rgba(122,90,7,0.07)", label: "WARNING", order: 2 },
  medium:   { color: "#7A5A07", bg: "rgba(122,90,7,0.07)", label: "MEDIUM", order: 3 },
  info:     { color: "#5F6B7A", bg: "rgba(95,107,122,0.05)", label: "INFO", order: 4 },
};

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

const AGENT_INDEX_MAP = { 0: "security", 1: "accessibility", 2: "qa", 3: "documentation" };
const AGENT_ID_MAP = { "code-analysis": "security", "accessibility": "accessibility", "qa-analysis": "qa", "documentation": "documentation" };
const REPORT_KEY_MAP = { codeAnalysis: "security", accessibility: "accessibility", qaAnalysis: "qa", hecvat: "hecvat", documentation: "documentation" };

// Extract findings from each agent's output format into a uniform shape
function extractFindings(agentId, data) {
  const normalize = (arr, prefix) => arr.map((f, i) => {
    // Parse "file:line" evidence format
    let file = f.file || f.location || "";
    let line = f.line || null;
    if (!file && f.evidence) {
      const m = f.evidence.match(/^(.+?):(\d+)/);
      if (m) { file = m[1]; line = m[2]; }
      else file = f.evidence;
    }
    return {
      id: `${prefix}-${i}`,
      agent: agentId,
      severity: (f.severity || f.level || "info").toLowerCase(),
      title: f.title || f.finding || f.description || "Finding",
      file, line,
      detail: f.detail || f.description || f.answer || "",
      remediation: f.remediation || f.recommendation || null,
      category: f.category || f.area || null,
      status: "open",
    };
  });

  if (agentId === "security" || agentId === "accessibility" || agentId === "qa") {
    // Agents 1, 2, 3: synthesis.json → { findings: [...] }
    const findings = data.findings || data.issues || [];
    // For QA agent, also merge bugFindings if present
    if (agentId === "qa" && data.bugFindings?.length) {
      const bugs = data.bugFindings.map(b => ({
        ...b,
        title: b.title || b.finding,
        severity: b.severity || "warning",
      }));
      const merged = [...findings, ...bugs.filter(b => !findings.some(f => f.title === b.title))];
      return normalize(merged, agentId);
    }
    return normalize(findings, agentId);
  }
  if (agentId === "hecvat") {
    // HECVAT is a self-assessment document, not an audit — questions that can't be
    // answered from code are left blank for human input. Not findings.
    return [];
  }
  if (agentId === "documentation") {
    // Agent 4 generates documents, not findings — return empty
    return [];
  }
  // Fallback
  return normalize(data.findings || data.issues || [], agentId);
}

// Finding categories for the review phase (reorganized from the 4 backend agents)
const FINDING_CATEGORIES = [
  { id: "code", name: "Code Quality", Icon: FileCode, color: "#8B5CF6" },
  { id: "security", name: "Security", Icon: Shield, color: "#D35C1A" },
  { id: "accessibility", name: "Accessibility", Icon: Eye, color: "#7C3AED" },
  { id: "qa", name: "QA / Bugs", Icon: ClipboardCheck, color: "#06B6D4" },
  { id: "docs", name: "Documentation", Icon: FileText, color: "#16864E" },
];

const AGENT_SOURCE_LABEL = {
  security: "Code / Security",
  accessibility: "Accessibility",
  qa: "QA / Bug Detection",
  documentation: "Documentation",
};

// Keywords to classify Agent 1 findings as security vs code
const SECURITY_KEYWORDS = [
  "secret", "credential", "password", "api key", "token", "auth", "csrf", "xss", "injection",
  "vulnerability", "cve", "owasp", "ssrf", "cors", "helmet", "encryption", "tls", "ssl",
  "rate limit", "security header", "sanitiz", "exploit", "hardcoded", "exposed", ".env",
];

function isSecurityFinding(f) {
  const text = `${f.title} ${f.detail} ${f.category || ""}`.toLowerCase();
  return SECURITY_KEYWORDS.some(kw => text.includes(kw));
}

// Remap agent findings into display categories
function remapFindings(agentFindings) {
  const mapped = { code: [], security: [], accessibility: [], qa: [], docs: [] };
  for (const [agentId, findings] of Object.entries(agentFindings)) {
    for (const f of findings) {
      if (agentId === "security") {
        // Split Agent 1 into code vs security
        if (isSecurityFinding(f)) mapped.security.push(f);
        else mapped.code.push(f);
      } else if (agentId === "accessibility") {
        mapped.accessibility.push(f);
      } else if (agentId === "qa") {
        mapped.qa.push(f);
      } else {
        mapped.docs.push(f);
      }
    }
  }
  return mapped;
}

// ═══════════════════════════════════════════════════════════
// DEMO / SIMULATION DATA
// ═══════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════
// SMALL COMPONENTS
// ═══════════════════════════════════════════════════════════

function SevBadge({ severity }) {
  const s = SEV[severity] || SEV.info;
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, background: s.bg,
      color: s.color, fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 0.5 }}>
      {s.label}
    </span>
  );
}

function StatusIcon({ status }) {
  if (status === "complete" || status === "resolved") return <CheckCircle size={14} color={C.accent} />;
  if (status === "wontfix") return <MinusCircle size={14} color={C.textDim} />;
  return <XCircle size={14} color={TRACK_COLORS[4]} />;
}

// ═══════════════════════════════════════════════════════════
// FILE TREE
// ═══════════════════════════════════════════════════════════

function FileTreeNode({ node, depth = 0, onSelect, selectedFile, path = "" }) {
  const [open, setOpen] = useState(depth < 2);
  const isDir = node.type === "dir";
  const hasFindings = !isDir && node.findings > 0;
  const fullPath = path ? `${path}/${node.name}` : node.name;
  const isSelected = !isDir && selectedFile === fullPath;
  const handleClick = () => isDir ? setOpen(!open) : onSelect?.(fullPath);
  const handleKeyDown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); } };
  return (
    <div>
      <div role="button" tabIndex={0} onClick={handleClick} onKeyDown={handleKeyDown}
        aria-expanded={isDir ? open : undefined}
        aria-selected={isSelected || undefined}
        aria-label={`${isDir ? (open ? "Collapse" : "Expand") + " folder" : "File"} ${node.name}${hasFindings ? `, ${node.findings} findings` : ""}`}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 8px", paddingLeft: 8 + depth * 16,
          borderRadius: 4, cursor: "pointer", fontSize: 12, color: hasFindings ? C.text : C.textMid,
          fontFamily: "'JetBrains Mono', monospace", fontWeight: hasFindings ? 600 : 400,
          background: isSelected ? C.accentSoft : "transparent", transition: "background .1s",
          overflow: "hidden", whiteSpace: "nowrap" }}
        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = C.surfaceHover; }}
        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}>
        {isDir ? (open ? <FolderOpen size={13} color={C.accent} style={{ flexShrink: 0 }} /> : <Folder size={13} color={C.textDim} style={{ flexShrink: 0 }} />) : <FileCode size={13} color={hasFindings ? TRACK_COLORS[3] : C.textDim} style={{ flexShrink: 0 }} />}
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{node.name}</span>
        {hasFindings && <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: SEV.high.bg, color: SEV.high.color, fontWeight: 700, flexShrink: 0 }}>{node.findings}</span>}
      </div>
      {isDir && open && node.children?.map((child, i) => (
        <FileTreeNode key={i} node={child} depth={depth + 1} onSelect={onSelect} selectedFile={selectedFile} path={isDir ? fullPath.replace(/\/$/, "") : fullPath} />
      ))}
    </div>
  );
}

function buildFileTree(findings) {
  const tree = {};
  for (const f of findings) {
    if (!f.file) continue;
    const parts = f.file.replace(/^\//, "").split("/");
    let current = tree;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        current[part] = current[part] || { name: part, type: "file", findings: 0 };
        current[part].findings++;
      } else {
        current[part] = current[part] || { name: part + "/", type: "dir", _children: {} };
        current = current[part]._children;
      }
    }
  }
  function toArray(obj) {
    return Object.values(obj).map(n => n.type === "dir" ? { ...n, children: toArray(n._children) } : n)
      .sort((a, b) => (a.type === "dir" ? 0 : 1) - (b.type === "dir" ? 0 : 1) || a.name.localeCompare(b.name));
  }
  return toArray(tree);
}

// ═══════════════════════════════════════════════════════════
// AGENT LOG PANEL
// ═══════════════════════════════════════════════════════════

function AgentLogPanel({ agent, logs, isRunning }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [logs]);
  return (
    <div style={{ borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border}`, background: C.surface }}>
      <div style={{ padding: "8px 12px", background: C.surfaceAlt, display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${C.border}` }}>
        <Terminal size={12} color={C.textDim} />
        <span style={{ fontSize: 11, color: C.textMid, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{agent.name} Agent</span>
        {isRunning && <span style={{ width: 6, height: 6, borderRadius: "50%", background: TRACK_COLORS[1], animation: "pulse 1.5s infinite" }} />}
      </div>
      <div ref={ref} style={{ padding: "8px 12px", maxHeight: 280, overflowY: "auto", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.7 }}>
        {logs.length === 0 && !isRunning && <div style={{ color: C.textDim }}>Waiting for agent to start...</div>}
        {logs.map((log, i) => {
          const isCrit = log.includes("CRITICAL") || log.includes("critical");
          const isWarn = log.includes("WARN") || log.includes("HIGH") || log.includes("high");
          const isFail = log.includes("FAIL") || log.includes("error");
          const isPass = log.includes("PASS") || log.includes("complete") || log.includes("done");
          const color = isCrit ? SEV.critical.color : (isWarn || isFail) ? SEV.high.color : isPass ? TRACK_COLORS[1] : C.textMid;
          return <div key={i} style={{ color }}>{log}</div>;
        })}
        {isRunning && <div style={{ color: C.textDim }}>█</div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// FINDING CARD (expandable)
// ═══════════════════════════════════════════════════════════

function FindingCard({ finding, onStatusChange }) {
  const [expanded, setExpanded] = useState(false);
  const s = SEV[finding.severity] || SEV.info;
  return (
    <div style={{ marginBottom: 6, borderRadius: 8, border: `1px solid ${C.border}`, borderLeft: `3px solid ${s.color}`,
      background: expanded ? C.surface : "transparent", transition: "all .15s" }}>
      <div role="button" tabIndex={0} onClick={() => setExpanded(!expanded)}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(!expanded); } }}
        aria-expanded={expanded} aria-label={`${finding.severity} finding: ${finding.title}`}
        style={{ padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
        {expanded ? <ChevronDown size={14} color={C.textDim} /> : <ChevronRight size={14} color={C.textDim} />}
        <SevBadge severity={finding.severity} />
        {finding.agent && AGENT_SOURCE_LABEL[finding.agent] && (
          <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
            background: C.surfaceAlt, color: C.textDim, letterSpacing: 0.3 }}>
            {AGENT_SOURCE_LABEL[finding.agent]}
          </span>
        )}
        {finding.priorStatus && finding.priorStatus !== "new" && (
          <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
            background: finding.priorStatus === "resolved" ? C.successBg : finding.priorStatus === "partial" ? C.warningBg : "transparent",
            color: finding.priorStatus === "resolved" ? C.success : finding.priorStatus === "partial" ? C.warning : C.textDim }}>
            {finding.priorStatus === "resolved" ? "FIXED" : finding.priorStatus === "partial" ? "PARTIAL" : "OPEN"}
          </span>
        )}
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.text, textDecoration: finding.priorStatus === "resolved" ? "line-through" : "none" }}>{finding.title}</span>
        <span style={{ fontSize: 11, color: C.textDim, fontFamily: "'JetBrains Mono', monospace" }}>{finding.file}{finding.line ? `:${finding.line}` : ""}</span>
        <StatusIcon status={finding.status} />
      </div>
      {expanded && (
        <div style={{ padding: "0 14px 14px 36px" }}>
          <p style={{ fontSize: 13, color: C.textMid, lineHeight: 1.6, margin: "0 0 10px" }}>{finding.detail}</p>
          {finding.remediation && (
            <div style={{ padding: "10px 12px", borderRadius: 6, background: C.accentSoft, border: `1px solid ${C.accent20}`, marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.accent, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>Remediation</div>
              <p style={{ fontSize: 12, color: C.text, lineHeight: 1.55, margin: 0 }}>{finding.remediation}</p>
            </div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            {["open", "resolved", "wontfix"].map(st => (
              <button key={st} onClick={(e) => { e.stopPropagation(); onStatusChange?.(finding.id, st); }}
                style={{ padding: "4px 10px", borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                  border: `1px solid ${finding.status === st ? C.accent : C.border}`,
                  background: finding.status === st ? C.accentSoft : "transparent",
                  color: finding.status === st ? C.accent : C.textMid }}>
                {st === "open" ? "Open" : st === "resolved" ? "Resolved" : "Won't Fix"}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

export default function CodeUpload({ toolId, runId: runIdProp, initialPhase }) {
  const { toast } = useToast();
  const [tool, setTool] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [file, setFile] = useState(null);
  const [runId, setRunId] = useState(runIdProp || null);
  const [completedRuns, setCompletedRuns] = useState([]);
  const [starting, setStarting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // { loaded, total } or null

  // Phase: upload | running | review
  const [phase, setPhase] = useState("upload");
  const [agentStates, setAgentStates] = useState({ security: "idle", accessibility: "idle", qa: "idle", documentation: "idle" });
  const [agentProgress, setAgentProgress] = useState({ security: 0, accessibility: 0, qa: 0, documentation: 0 });
  const [agentLogs, setAgentLogs] = useState({ security: [], accessibility: [], qa: [], documentation: [] });
  const [expandedAgent, setExpandedAgent] = useState("security");

  // Queue position
  const [queuePosition, setQueuePosition] = useState(null);

  // Review state
  const [findings, setFindings] = useState({});
  const [sevFilter, setSevFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [viewMode, setViewMode] = useState("summary");
  const [selectedFile, setSelectedFile] = useState(null);
  const [submitted, setSubmitted] = useState(null);

  // Cancel
  const [cancelling, setCancelling] = useState(false);

  // SSE
  const { events, done: sseDone, failed: sseFailed, connectionLost } = usePipelineStream(runId);
  const [pipelineError, setPipelineError] = useState(null);

  // Load tool and check for active pipeline runs (skip for demo mode)
  useEffect(() => {
    setLoading(true);
    getTool(toolId)
      .then(data => {
        setTool(data.tool);
        // Check for active/queued pipeline runs to resume
        const runs = data.runs || [];
        setCompletedRuns(runs.filter(r => r.status === "completed"));
        const activeRun = runs.find(r => r.status === "running" || r.status === "queued");
        // If a specific runId was requested, use that; otherwise fall back to latest completed
        const targetRunId = runIdProp || null;
        const completedRun = targetRunId
          ? runs.find(r => r.id === targetRunId && r.status === "completed")
          : runs.find(r => r.status === "completed");
        if (activeRun && !targetRunId) {
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
            // Fallback: if current_agent_index is set but DB row not yet updated to running
            const curIdx = runData.run?.current_agent_index;
            if (curIdx != null) {
              const curAgentId = AGENT_INDEX_MAP[curIdx];
              if (curAgentId) {
                setAgentStates(p => p[curAgentId] === "idle" ? { ...p, [curAgentId]: "running" } : p);
              }
            }
          }).catch(() => {});
        } else if (initialPhase === "review" && completedRun) {
          setRunId(completedRun.id);
          getReport(completedRun.id).then(reportData => {
            const report = reportData.report || reportData;
            if (report?.agents) {
              const mapped = {};
              for (const [key, agentData] of Object.entries(report.agents)) {
                const id = REPORT_KEY_MAP[key] || key;
                mapped[id] = extractFindings(id, agentData);
              }
              setFindings(mapped);
            }
            setAgentStates({ security: "complete", accessibility: "complete", qa: "complete", documentation: "complete" });
            setAgentProgress({ security: 1, accessibility: 1, qa: 1, documentation: 1 });
            setPhase("review");
          }).catch(() => {});
        }
        // No active run + no initialPhase="review" — show upload phase so user can re-upload and re-scan
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [toolId]);

  // Process SSE events — track index to avoid duplicates
  const processedRef = useRef(0);
  useEffect(() => {
    for (let i = processedRef.current; i < events.length; i++) {
      const event = events[i];
      // Catch-up state from SSE reconnect — restore agent states from DB
      if (event.type === "state") {
        setQueuePosition(event.queuePosition || null);
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
        // If the run has a current_agent_index but the DB update hasn't landed yet,
        // use it to mark the current agent as running (avoids SSE reconnect race)
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
    }
    processedRef.current = events.length;
  }, [events]);

  // Handle pipeline failure
  useEffect(() => {
    if (phase === "running" && sseFailed) {
      // Find error from SSE events
      const failEvent = events.findLast(e => e.type === "status" && e.status === "failed");
      const stateEvent = events.findLast(e => e.type === "state");
      const errorMsg = failEvent?.error || stateEvent?.run?.error_message || "Pipeline failed";
      setPipelineError(errorMsg);
    }
  }, [phase, sseFailed, events]);

  // Transition to review when completed (not failed)
  useEffect(() => {
    if (phase === "running" && sseDone && !sseFailed) {
      setAgentStates({ security: "complete", accessibility: "complete", qa: "complete", documentation: "complete" });
      setAgentProgress({ security: 1, accessibility: 1, qa: 1, documentation: 1 });
      Promise.all([
        getReport(runId),
        getTool(toolId).then(d => { setTool(d.tool); setCompletedRuns((d.runs || []).filter(r => r.status === "completed")); }),
      ])
        .then(([data]) => {
          const report = data.report || data;
          if (report?.agents) {
            const mapped = {};
            for (const [key, agentData] of Object.entries(report.agents)) {
              const id = REPORT_KEY_MAP[key] || key;
              mapped[id] = extractFindings(id, agentData);
            }
            setFindings(mapped);
          }
          setTimeout(() => setPhase("review"), 600);
        })
        .catch(err => {
          setPipelineError(`Failed to load report: ${err.message}`);
        });
    }
  }, [phase, sseDone, sseFailed, runId]);

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
      // Upload codebase first
      await uploadCodebase(toolId, file, setUploadProgress);
      setUploadProgress(null);
      // Then start the pipeline
      const result = await startPipelineRun(toolId, tool?.track);
      setRunId(result.run.id);
      setPhase("running");
      toast.success("Pipeline started");
    } catch (err) {
      toast.error(err.message);
      setUploadProgress(null);
      setStarting(false);
    }
  }

  // Status change on findings
  const handleStatusChange = (findingId, status) => {
    setFindings(prev => {
      const updated = {};
      for (const [agentId, agentFindings] of Object.entries(prev)) {
        updated[agentId] = agentFindings.map(f => f.id === findingId ? { ...f, status } : f);
      }
      return updated;
    });
  };

  // Computed — remap agent findings into display categories
  const displayFindings = useMemo(() => remapFindings(findings), [findings]);

  const allFindings = useMemo(() =>
    Object.entries(displayFindings).flatMap(([catId, fs]) => fs.map(f => ({ ...f, categoryId: catId }))),
    [displayFindings]);

  const filteredFindings = useMemo(() =>
    allFindings
      .filter(f => sevFilter === "all" || f.severity === sevFilter)
      .filter(f => agentFilter === "all" || f.categoryId === agentFilter)
      .sort((a, b) => (SEV[a.severity]?.order ?? 4) - (SEV[b.severity]?.order ?? 4)),
    [allFindings, sevFilter, agentFilter]);

  const stats = useMemo(() => ({
    total: allFindings.length,
    critical: allFindings.filter(f => f.severity === "critical").length,
    high: allFindings.filter(f => f.severity === "high").length,
    warning: allFindings.filter(f => f.severity === "warning").length,
    medium: allFindings.filter(f => f.severity === "medium").length,
    info: allFindings.filter(f => f.severity === "info").length,
    open: allFindings.filter(f => f.status === "open").length,
    resolved: allFindings.filter(f => f.status === "resolved").length,
  }), [allFindings]);

  const fileTree = useMemo(() => buildFileTree(allFindings), [allFindings]);

  if (loading) return <div style={{ padding: 24 }}><Skeleton height={200} /></div>;
  if (error) return <div style={{ padding: 24 }}><ErrorBanner message={error} /></div>;

  return (
    <div>
      {/* Status bar when running or review */}
      {phase !== "upload" && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{tool?.name || "Tool"}</div>
            {tool?.track && <TrackBadge track={tool.track} />}
          </div>
          {phase === "review" && (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {completedRuns.length > 1 && (
                <select
                  value={runId || ""}
                  onChange={e => navigate(`/review/${toolId}/${e.target.value}`)}
                  aria-label="Select pipeline run"
                  style={{ padding: "5px 10px", borderRadius: 7, border: `1px solid ${C.border}`, background: C.surface,
                    fontSize: 12, color: C.text, fontFamily: "'DM Sans', sans-serif", cursor: "pointer" }}>
                  {completedRuns.map((r, i) => (
                    <option key={r.id} value={r.id}>
                      {i === 0 ? "Latest" : `Run ${completedRuns.length - i}`} — {relativeTime(r.completed_at || r.queued_at)} · Track {r.track}
                    </option>
                  ))}
                </select>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textMid }}>
                <span style={{ fontWeight: 700, color: TRACK_COLORS[4] }}>{stats.open}</span> open
                <span style={{ color: C.border }}>·</span>
                <span style={{ fontWeight: 700, color: TRACK_COLORS[1] }}>{stats.resolved}</span> resolved
              </div>
              <button type="button" onClick={() => navigate(`/upload/${toolId}`)}
                style={{ padding: "6px 14px", borderRadius: 7, border: `1px solid ${C.border}`, background: "transparent",
                  cursor: "pointer", fontSize: 12, fontWeight: 600, color: C.textMid,
                  fontFamily: "'DM Sans', sans-serif", display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Upload size={12} /> Re-scan
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── PHASE: UPLOAD ── */}
      {phase === "upload" && (
        <div style={{ maxWidth: 640, margin: "48px auto" }}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px" }}>Upload Your Code</h1>
            <p style={{ fontSize: 14, color: C.textMid, margin: 0 }}>Submit your codebase as a .zip archive. Four AI agents will review it in parallel.</p>
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 28 }}>
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
                <div style={{ width: "100%", height: 8, borderRadius: 4, background: C.border, overflow: "hidden" }}>
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
            <div className="info-banner" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
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
            <div style={{ padding: "14px 16px", borderRadius: 8, background: "rgba(201,48,44,0.07)", border: `1px solid rgba(201,48,44,0.2)`, marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: TRACK_COLORS[4], marginBottom: 4 }}>Pipeline Failed</div>
              <div style={{ fontSize: 13, color: C.text, marginBottom: 10 }}>{pipelineError}</div>
              <button onClick={() => { setPipelineError(null); setRunId(null); setPhase("upload"); setAgentStates({ security: "idle", accessibility: "idle", qa: "idle", documentation: "idle" }); setAgentProgress({ security: 0, accessibility: 0, qa: 0, documentation: 0 }); setAgentLogs({ security: [], accessibility: [], qa: [], documentation: [] }); }}
                style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent",
                  cursor: "pointer", fontSize: 13, fontWeight: 600, color: C.text, fontFamily: "'DM Sans', sans-serif" }}>
                Back to Upload
              </button>
            </div>
          )}
          {connectionLost && !pipelineError && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(201,48,44,0.07)", border: `1px solid rgba(201,48,44,0.2)`, marginBottom: 16, fontSize: 13, color: TRACK_COLORS[4] }}>
              Connection lost. The pipeline continues server-side — refresh to check status.
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16 }}>
            {/* Agent sidebar */}
            <div>
              {AGENTS.map(agent => {
                const state = agentStates[agent.id];
                const progress = agentProgress[agent.id];
                const phaseIdx = Math.min(Math.floor(progress * agent.phases.length), agent.phases.length - 1);
                const phaseLabel = agent.phases[phaseIdx];
                const isActive = expandedAgent === agent.id;
                return (
                  <div key={agent.id} onClick={() => setExpandedAgent(agent.id)}
                    style={{ padding: 14, borderRadius: 10, background: isActive ? C.surface : "transparent",
                      border: `1px solid ${isActive ? agent.color + "40" : C.border}`, marginBottom: 8, cursor: "pointer", transition: "all .15s" }}>
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
                    <div style={{ height: 3, borderRadius: 2, background: C.border, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${progress * 100}%`, borderRadius: 2,
                        background: state === "complete" ? TRACK_COLORS[1] : agent.color, transition: "width .1s linear" }} />
                    </div>
                  </div>
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

      {/* ── PHASE: REVIEW ── */}
      {phase === "review" && (
        <div>
          {/* Summary bar */}
          <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
            {[
              { label: "Critical", count: stats.critical, color: SEV.critical.color },
              { label: "High", count: stats.high, color: SEV.high.color },
              { label: "Warning", count: stats.warning, color: SEV.warning.color },
              { label: "Medium", count: stats.medium, color: SEV.medium.color },
              { label: "Info", count: stats.info, color: SEV.info.color },
            ].map(s => (
              <div key={s.label} style={{ padding: "12px 16px", borderRadius: 8, background: C.surface, border: `1px solid ${C.border}`, flex: 1, textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: s.count > 0 ? s.color : C.textDim, fontFamily: "'JetBrains Mono', monospace" }}>{s.count}</div>
                <div style={{ fontSize: 11, color: C.textMid, fontWeight: 600 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* View mode tabs + filters */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 4 }}>
              {[["summary","Summary"],["findings","Findings"],["files","File Tree"]].map(([v,l]) => (
                <button key={v} onClick={() => setViewMode(v)}
                  style={{ padding: "7px 16px", borderRadius: 6, border: `1px solid ${viewMode === v ? C.accent : C.border}`,
                    background: viewMode === v ? C.accentSoft : "transparent", color: viewMode === v ? C.accent : C.textMid,
                    fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
                  {l}
                </button>
              ))}
            </div>
            {viewMode === "findings" && (
              <div style={{ display: "flex", gap: 4 }}>
                <select value={sevFilter} onChange={e => setSevFilter(e.target.value)}
                  style={{ padding: "5px 10px", borderRadius: 5, border: `1px solid ${C.border}`, background: C.surface,
                    color: C.text, fontSize: 12, fontFamily: "'DM Sans', sans-serif", cursor: "pointer" }}>
                  <option value="all">All severities</option>
                  {Object.entries(SEV).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)}
                  style={{ padding: "5px 10px", borderRadius: 5, border: `1px solid ${C.border}`, background: C.surface,
                    color: C.text, fontSize: 12, fontFamily: "'DM Sans', sans-serif", cursor: "pointer" }}>
                  <option value="all">All categories</option>
                  {FINDING_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* VIEW: Findings */}
          {viewMode === "findings" && (
            <div>
              <div style={{ fontSize: 12, color: C.textMid, marginBottom: 12 }}>{filteredFindings.length} findings</div>
              {filteredFindings.length === 0 ? (
                <div style={{ padding: 32, textAlign: "center", color: C.textMid, fontSize: 14 }}>
                  {allFindings.length === 0 ? "No findings data available yet." : "No findings match the current filters."}
                </div>
              ) : filteredFindings.map(f => (
                <FindingCard key={f.id} finding={f} onStatusChange={handleStatusChange} />
              ))}
            </div>
          )}

          {/* VIEW: File Tree */}
          {viewMode === "files" && (
            <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 20 }}>
              <div style={{ padding: 12, borderRadius: 10, background: C.surface, border: `1px solid ${C.border}`, overflow: "hidden" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, fontFamily: "'JetBrains Mono', monospace" }}>
                  Project Files
                </div>
                {fileTree.length > 0 ? fileTree.map((node, i) => (
                  <FileTreeNode key={i} node={node} selectedFile={selectedFile}
                    onSelect={f => setSelectedFile(selectedFile === f ? null : f)} />
                )) : (
                  <div style={{ fontSize: 12, color: C.textMid }}>No file data available.</div>
                )}
              </div>
              <div>
                {selectedFile ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 13, color: C.textMid }}>Showing findings in</span>
                    <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: C.accent }}>{selectedFile}</span>
                    <button onClick={() => setSelectedFile(null)} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: `1px solid ${C.border}`, background: "transparent", cursor: "pointer", color: C.textMid }}>Clear</button>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: C.textMid, marginBottom: 12 }}>Click a file to filter findings by location.</div>
                )}
                {allFindings
                  .filter(f => !selectedFile || (f.file && f.file.includes(selectedFile)))
                  .sort((a, b) => (SEV[a.severity]?.order ?? 4) - (SEV[b.severity]?.order ?? 4))
                  .map(f => (
                    <FindingCard key={f.id} finding={f} onStatusChange={handleStatusChange} />
                  ))}
                {selectedFile && allFindings.filter(f => f.file && f.file.includes(selectedFile)).length === 0 && (
                  <div style={{ padding: 32, textAlign: "center", color: C.textMid, fontSize: 13 }}>No findings for this file.</div>
                )}
              </div>
            </div>
          )}

          {/* VIEW: Summary */}
          {viewMode === "summary" && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
                {FINDING_CATEGORIES.map(cat => {
                  const af = displayFindings[cat.id] || [];
                  const crit = af.filter(f => f.severity === "critical").length;
                  const high = af.filter(f => f.severity === "high").length;
                  const open = af.filter(f => f.status === "open").length;
                  const resolved = af.filter(f => f.status === "resolved" || f.status === "complete").length;
                  return (
                    <div key={cat.id} style={{ padding: 20, borderRadius: 10, background: C.surface, border: `1px solid ${C.border}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: `${cat.color}12` }}>
                          <cat.Icon size={18} color={cat.color} />
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>{cat.name}</div>
                          <div style={{ fontSize: 11, color: C.textMid }}>{af.length} findings</div>
                        </div>
                      </div>
                      {af.length > 0 && (
                        <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 10, background: C.border }}>
                          {["critical","high","warning","medium","info"].map(sev => {
                            const count = af.filter(f => f.severity === sev).length;
                            if (count === 0) return null;
                            return <div key={sev} style={{ width: `${(count / af.length) * 100}%`, background: SEV[sev].color }} />;
                          })}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
                        {crit > 0 && <span style={{ color: SEV.critical.color, fontWeight: 700 }}>{crit} critical</span>}
                        {high > 0 && <span style={{ color: SEV.high.color, fontWeight: 700 }}>{high} high</span>}
                        <span style={{ color: C.textMid }}>{open} open</span>
                        <span style={{ color: TRACK_COLORS[1] }}>{resolved} resolved</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Remediation progress */}
              <div style={{ padding: 20, borderRadius: 10, background: C.surface, border: `1px solid ${C.border}` }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 14px" }}>Remediation Progress</h3>
                <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: C.border, marginBottom: 12 }}>
                  {stats.resolved > 0 && <div style={{ width: `${(stats.resolved / stats.total) * 100}%`, background: TRACK_COLORS[1], transition: "width .3s" }} />}
                  {allFindings.filter(f => f.status === "wontfix").length > 0 && <div style={{ width: `${(allFindings.filter(f => f.status === "wontfix").length / stats.total) * 100}%`, background: C.textDim, transition: "width .3s" }} />}
                </div>
                <div style={{ display: "flex", gap: 20, fontSize: 13, color: C.textMid }}>
                  <span><span style={{ fontWeight: 700, color: TRACK_COLORS[1] }}>{stats.resolved}</span> resolved</span>
                  <span><span style={{ fontWeight: 700, color: C.textDim }}>{allFindings.filter(f => f.status === "wontfix").length}</span> won't fix</span>
                  <span><span style={{ fontWeight: 700, color: TRACK_COLORS[4] }}>{stats.open}</span> open</span>
                  <span style={{ marginLeft: "auto", fontWeight: 700, color: C.text }}>{stats.total} total findings</span>
                </div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          {!submitted && !["under_review", "approved", "active", "changes_requested"].includes(tool?.status) ? (
            <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
              <button onClick={async () => {
                  const newStatus = (tool?.track || 3) <= 2 ? "active" : "under_review";
                  if (tool?.status === newStatus) { setSubmitted(newStatus); return; }
                  try {
                    await updateToolStatus(toolId, newStatus);
                    setSubmitted(newStatus);
                  } catch (err) { toast.error(err.message); }
                }}
                style={{ padding: "13px 32px", borderRadius: 10, border: "none", cursor: "pointer",
                  background: `linear-gradient(135deg, ${TRACK_COLORS[1]}, #128A42)`, color: "#fff", fontSize: 15, fontWeight: 700,
                  fontFamily: "'DM Sans', sans-serif", boxShadow: `0 4px 20px ${TRACK_COLORS[1]}35` }}>
                {(tool?.track || 3) <= 2 ? "Acknowledge Findings & Register →" : "Submit for IT Review →"}
              </button>
              {runId && <>
                <button onClick={() => navigate(`/tool/${toolId}/report/${runId}`)}
                  style={{ padding: "13px 24px", borderRadius: 10, border: `1.5px solid ${C.border}`, cursor: "pointer",
                    background: "transparent", color: C.textMid, fontSize: 14, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>
                  View Full Report
                </button>
                <a href={getFindingsCsvUrl(runId)} style={{ padding: "13px 18px", borderRadius: 10, border: `1.5px solid ${C.border}`,
                  background: "transparent", color: C.textMid, fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
                  textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                  Export CSV
                </a>
                <a href={getFindingsJsonUrl(runId)} style={{ padding: "13px 18px", borderRadius: 10, border: `1.5px solid ${C.border}`,
                  background: "transparent", color: C.textMid, fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
                  textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                  Export JSON
                </a>
              </>}
            </div>
          ) : (
            <div style={{ marginTop: 24, padding: 24, borderRadius: 12, background: C.accentSoft, border: `1px solid ${C.accent30}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <Check size={20} color={C.accent} />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.accent }}>
                  {submitted === "active" ? "Tool Registered" : "Submitted for IT Review"}
                </h3>
              </div>
              {submitted === "active" ? (
                <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.7 }}>
                  <p style={{ margin: "0 0 8px" }}><strong>{tool?.name}</strong> has been registered in the institutional registry. No further action is required.</p>
                  <p style={{ margin: 0 }}>You can view your tool's status and reports anytime from the registry.</p>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.7 }}>
                  <p style={{ margin: "0 0 8px" }}><strong>{tool?.name}</strong> has been submitted for IT security review (Track {tool?.track}).</p>
                  <p style={{ margin: "0 0 8px" }}>What happens next:</p>
                  <ol style={{ margin: "0 0 8px", paddingLeft: 20 }}>
                    <li>An IT reviewer will be assigned to evaluate the pipeline findings</li>
                    <li>You may be contacted for clarification on specific items</li>
                    <li>Critical and high-severity findings must be resolved before approval</li>
                    <li>You'll receive notification when the review is complete</li>
                  </ol>
                  <p style={{ margin: 0 }}>
                    <strong>{stats.critical + stats.high}</strong> critical/high findings and <strong>{stats.warning + stats.medium}</strong> warning/medium findings were identified.
                    {stats.critical + stats.high > 0 ? " Address critical and high items to expedite review." : ""}
                  </p>
                </div>
              )}
              <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
                <button onClick={() => navigate(`/tool/${toolId}`)}
                  style={{ padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer",
                    background: C.accent, color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>
                  View Tool Details
                </button>
                <button onClick={() => navigate("/registry")}
                  style={{ padding: "10px 20px", borderRadius: 8, border: `1.5px solid ${C.border}`, cursor: "pointer",
                    background: "transparent", color: C.textMid, fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>
                  Back to Registry
                </button>
                {runId && (
                  <button onClick={() => navigate(`/tool/${toolId}/report/${runId}`)}
                    style={{ padding: "10px 20px", borderRadius: 8, border: `1.5px solid ${C.border}`, cursor: "pointer",
                      background: "transparent", color: C.textMid, fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>
                    View Full Report
                  </button>
                )}
              </div>
            </div>
          )}
          {!submitted && ["under_review", "approved", "active", "changes_requested"].includes(tool?.status) && (
            <div style={{ marginTop: 24, padding: 24, borderRadius: 12, background: C.accentSoft, border: `1px solid ${C.accent30}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <Check size={20} color={C.accent} />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.accent }}>
                  {tool.status === "active" ? "Tool Active" : tool.status === "approved" ? "Tool Approved" : tool.status === "under_review" ? "Under Review" : "Changes Requested"}
                </h3>
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
                <button onClick={() => navigate(`/tool/${toolId}`)}
                  style={{ padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer",
                    background: C.accent, color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>
                  View Tool Details
                </button>
                {runId && <>
                  <button onClick={() => navigate(`/tool/${toolId}/report/${runId}`)}
                    style={{ padding: "10px 20px", borderRadius: 8, border: `1.5px solid ${C.border}`, cursor: "pointer",
                      background: "transparent", color: C.textMid, fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>
                    View Full Report
                  </button>
                  <a href={getFindingsCsvUrl(runId)} style={{ padding: "10px 16px", borderRadius: 8, border: `1.5px solid ${C.border}`,
                    background: "transparent", color: C.textMid, fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
                    textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                    Export CSV
                  </a>
                  <a href={getFindingsJsonUrl(runId)} style={{ padding: "10px 16px", borderRadius: 8, border: `1.5px solid ${C.border}`,
                    background: "transparent", color: C.textMid, fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
                    textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                    Export JSON
                  </a>
                </>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
