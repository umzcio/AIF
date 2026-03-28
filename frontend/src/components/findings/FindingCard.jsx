import { useState } from "react";
import { ChevronRight, ChevronDown, CheckCircle, XCircle, MinusCircle, ShieldOff } from "lucide-react";
import { C, TRACK_COLORS } from "../../constants.js";
import { SEV, AGENT_SOURCE_LABEL } from "./utils.js";

export function SevBadge({ severity }) {
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
  if (status === "false_positive") return <ShieldOff size={14} color="#7C3AED" />;
  if (status === "wontfix") return <MinusCircle size={14} color={C.textDim} />;
  return <XCircle size={14} color={TRACK_COLORS[4]} />;
}

export default function FindingCard({ finding, onStatusChange }) {
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
        <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: 0.3,
          background: finding.toolVerified ? "rgba(22,134,78,0.08)" : "rgba(124,58,237,0.08)",
          color: finding.toolVerified ? "#16864E" : "#7C3AED" }}>
          {finding.toolVerified
            ? (finding.reportedBy?.[0] || "TOOL")
            : "AI"}
        </span>
        {finding.priorStatus && finding.priorStatus !== "new" && (
          <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
            background: finding.priorStatus === "resolved" ? C.successBg : finding.priorStatus === "partial" ? C.warningBg : "transparent",
            color: finding.priorStatus === "resolved" ? C.success : finding.priorStatus === "partial" ? C.warning : C.textDim }}>
            {finding.priorStatus === "resolved" ? "FIXED" : finding.priorStatus === "partial" ? "PARTIAL" : "OPEN"}
          </span>
        )}
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600,
          color: finding.status === "false_positive" ? C.textDim : C.text,
          textDecoration: finding.priorStatus === "resolved" || finding.status === "false_positive" ? "line-through" : "none" }}>{finding.title}</span>
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
            {[["open", "Open"], ["resolved", "Resolved"], ["false_positive", "False Positive"], ["wontfix", "Won't Fix"]].map(([st, label]) => {
              const isFP = st === "false_positive";
              const active = finding.status === st;
              return (
                <button key={st} onClick={(e) => { e.stopPropagation(); onStatusChange?.(finding.id, st); }}
                  style={{ padding: "4px 10px", borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif",
                    border: `1px solid ${active ? (isFP ? "#7C3AED" : C.accent) : C.border}`,
                    background: active ? (isFP ? "rgba(124,58,237,0.08)" : C.accentSoft) : "transparent",
                    color: active ? (isFP ? "#7C3AED" : C.accent) : C.textMid }}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
