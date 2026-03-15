import { Shield, Eye, ClipboardCheck, FileText, FileCode } from "lucide-react";

// ═══════════════════════════════════════════════════════════
// SEVERITY CONFIG
// ═══════════════════════════════════════════════════════════

export const SEV = {
  critical: { color: "#C9302C", bg: "rgba(201,48,44,0.07)", label: "CRITICAL", order: 0 },
  high:     { color: "#A34414", bg: "rgba(163,68,20,0.07)", label: "HIGH", order: 1 },
  warning:  { color: "#5C4706", bg: "rgba(122,90,7,0.07)", label: "WARNING", order: 2 },
  medium:   { color: "#5C4706", bg: "rgba(122,90,7,0.07)", label: "MEDIUM", order: 3 },
  info:     { color: "#5F6B7A", bg: "rgba(95,107,122,0.05)", label: "INFO", order: 4 },
};

// ═══════════════════════════════════════════════════════════
// AGENT MAPS
// ═══════════════════════════════════════════════════════════

export const AGENT_INDEX_MAP = { 0: "security", 1: "accessibility", 2: "qa", 3: "documentation" };
export const AGENT_ID_MAP = { "code-analysis": "security", "accessibility": "accessibility", "qa-analysis": "qa", "documentation": "documentation" };
export const REPORT_KEY_MAP = { codeAnalysis: "security", accessibility: "accessibility", qaAnalysis: "qa", hecvat: "hecvat", documentation: "documentation" };

// ═══════════════════════════════════════════════════════════
// FINDING EXTRACTION
// ═══════════════════════════════════════════════════════════

export function extractFindings(agentId, data) {
  const normalize = (arr, prefix) => arr.map((f, i) => {
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
    const findings = data.findings || data.issues || [];
    // Use bugFindings only as a fallback when findings is empty (they overlap in QA synthesis)
    if (agentId === "qa" && findings.length === 0 && data.bugFindings?.length) {
      const bugs = data.bugFindings.map(b => ({
        ...b,
        title: b.title || b.finding,
        severity: b.severity || "warning",
      }));
      return normalize(bugs, agentId);
    }
    return normalize(findings, agentId);
  }
  if (agentId === "hecvat") return [];
  if (agentId === "documentation") return [];
  return normalize(data.findings || data.issues || [], agentId);
}

// ═══════════════════════════════════════════════════════════
// FINDING CATEGORIES & REMAPPING
// ═══════════════════════════════════════════════════════════

export const FINDING_CATEGORIES = [
  { id: "code", name: "Code Quality", Icon: FileCode, color: "#8B5CF6" },
  { id: "security", name: "Security", Icon: Shield, color: "#D35C1A" },
  { id: "accessibility", name: "Accessibility", Icon: Eye, color: "#7C3AED" },
  { id: "qa", name: "QA / Bugs", Icon: ClipboardCheck, color: "#06B6D4" },
  { id: "docs", name: "Documentation", Icon: FileText, color: "#16864E" },
];

export const AGENT_SOURCE_LABEL = {
  security: "Code / Security",
  accessibility: "Accessibility",
  qa: "QA / Bug Detection",
  documentation: "Documentation",
};

const SECURITY_KEYWORDS = [
  "secret", "credential", "password", "api key", "token", "auth", "csrf", "xss", "injection",
  "vulnerability", "cve", "owasp", "ssrf", "cors", "helmet", "encryption", "tls", "ssl",
  "rate limit", "security header", "sanitiz", "exploit", "hardcoded", "exposed", ".env",
];

export function isSecurityFinding(f) {
  const text = `${f.title} ${f.detail} ${f.category || ""}`.toLowerCase();
  return SECURITY_KEYWORDS.some(kw => text.includes(kw));
}

export function remapFindings(agentFindings) {
  const mapped = { code: [], security: [], accessibility: [], qa: [], docs: [] };
  for (const [agentId, findings] of Object.entries(agentFindings)) {
    for (const f of findings) {
      if (agentId === "security") {
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
// FILE TREE
// ═══════════════════════════════════════════════════════════

export function buildFileTree(findings) {
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
// STATUS HELPERS
// ═══════════════════════════════════════════════════════════

export function applyStatuses(mapped, savedStatuses) {
  if (!savedStatuses || Object.keys(savedStatuses).length === 0) return mapped;
  const result = {};
  for (const [agentId, agentFindings] of Object.entries(mapped)) {
    result[agentId] = agentFindings.map(f => savedStatuses[f.id] ? { ...f, status: savedStatuses[f.id] } : f);
  }
  return result;
}
