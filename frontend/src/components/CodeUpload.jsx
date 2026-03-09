import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Shield, Eye, ClipboardCheck, FileText, Upload, Package, Check, ChevronRight, ChevronDown, Clock, FileCode, Folder, FolderOpen, ArrowRight, Terminal, CheckCircle, XCircle, MinusCircle } from "lucide-react";
import { C, SEVERITY_CONFIG, TRACK_COLORS } from "../constants.js";
import { navigate } from "../hooks/useHashRouter.js";
import { getTool, startPipelineRun, getReport, getPipelineRun, updateToolStatus, uploadCodebase } from "../api.js";
import { usePipelineStream } from "../hooks/useSSE.js";
import { useToast } from "./Toast.jsx";
import { TrackBadge, Skeleton, ErrorBanner } from "./primitives.jsx";

// ═══════════════════════════════════════════════════════════
// AGENT DEFINITIONS
// ═══════════════════════════════════════════════════════════

const SEV = {
  critical: { color: "#C9302C", bg: "rgba(201,48,44,0.07)", label: "CRITICAL", order: 0 },
  high:     { color: "#D35C1A", bg: "rgba(211,92,26,0.07)", label: "HIGH", order: 1 },
  medium:   { color: "#A07816", bg: "rgba(160,120,22,0.07)", label: "MEDIUM", order: 2 },
  low:      { color: "#1A6B4B", bg: "rgba(26,107,75,0.07)", label: "LOW", order: 3 },
  info:     { color: "#5F6B7A", bg: "rgba(95,107,122,0.05)", label: "INFO", order: 4 },
};

const AGENTS = [
  { id: "security", name: "Code / Security", Icon: Shield, color: "#D35C1A",
    desc: "Static analysis, dependency audit, secrets scan, OWASP checks",
    phases: ["Unpacking archive", "Scanning dependencies", "Static analysis", "Secrets detection", "OWASP rule check", "Generating report"] },
  { id: "accessibility", name: "Accessibility", Icon: Eye, color: "#7C3AED",
    desc: "WCAG 2.2 AA compliance, Section 508, screen reader compatibility",
    phases: ["Parsing HTML/JSX templates", "Color contrast analysis", "ARIA attribute check", "Keyboard navigation audit", "Screen reader simulation", "Generating report"] },
  { id: "hecvat", name: "HECVAT-Lite", Icon: ClipboardCheck, color: "#0891B2",
    desc: "Higher Ed vendor assessment — data handling, auth, encryption, privacy",
    phases: ["Mapping data flows", "Authentication review", "Encryption assessment", "Privacy policy check", "Compliance mapping", "Generating report"] },
  { id: "documentation", name: "Documentation", Icon: FileText, color: "#16864E",
    desc: "Auto-generate user guide, admin guide, and consolidated findings report",
    phases: ["Analyzing codebase structure", "Extracting API surface", "Writing user guide", "Writing admin guide", "Compiling findings report", "Final review"] },
];

const AGENT_INDEX_MAP = { 0: "security", 1: "accessibility", 2: "hecvat", 3: "documentation" };
const AGENT_ID_MAP = { "code-analysis": "security", "accessibility": "accessibility", "hecvat": "hecvat", "documentation": "documentation" };
const REPORT_KEY_MAP = { codeAnalysis: "security", accessibility: "accessibility", hecvat: "hecvat", documentation: "documentation" };

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
      severity: (f.severity || f.level || "info").toLowerCase().replace("warning", "high"),
      title: f.title || f.finding || f.description || "Finding",
      file, line,
      detail: f.detail || f.description || f.answer || "",
      remediation: f.remediation || f.recommendation || null,
      category: f.category || f.area || null,
      status: "open",
    };
  });

  if (agentId === "security" || agentId === "accessibility") {
    // Agents 1 & 2: synthesis.json → { findings: [...] }
    return normalize(data.findings || data.issues || [], agentId);
  }
  if (agentId === "hecvat") {
    // Agent 3: hecvat_assessment.json → { highRiskFindings: [...], nonNegotiableFailures: [...], questions: [...] }
    const results = [];
    for (const f of (data.nonNegotiableFailures || [])) {
      results.push({ ...f, severity: "critical", title: `${f.id}: ${f.question || f.finding || "Non-negotiable failure"}` });
    }
    for (const f of (data.highRiskFindings || [])) {
      results.push({ ...f, title: `${f.id || f.area}: ${f.finding || f.title || "High risk finding"}` });
    }
    // Also include failed/partial questions as findings
    for (const q of (data.questions || [])) {
      if (q.status === "no") {
        results.push({ severity: "high", title: `${q.id}: Non-compliant`, detail: q.answer, evidence: q.evidence, remediation: null });
      } else if (q.status === "partial") {
        results.push({ severity: "medium", title: `${q.id}: Partially compliant`, detail: q.answer, evidence: q.evidence, remediation: null });
      }
    }
    return normalize(results, "hec");
  }
  if (agentId === "documentation") {
    // Agent 4: documentation.json → { userGuide, adminGuide, complianceSummary, metadata }
    const results = [];
    if (data.userGuide) results.push({ severity: "info", title: "User guide generated", detail: `${data.metadata?.wordCount?.userGuide || "~1,000"} words`, file: "docs/USER_GUIDE.docx" });
    if (data.adminGuide) results.push({ severity: "info", title: "Admin guide generated", detail: `${data.metadata?.wordCount?.adminGuide || "~1,500"} words`, file: "docs/ADMIN_GUIDE.docx" });
    if (data.complianceSummary) results.push({ severity: "info", title: "Compliance summary generated", detail: `${data.metadata?.wordCount?.complianceSummary || "~1,000"} words`, file: "docs/COMPLIANCE_SUMMARY.docx" });
    if (data.metadata?.todoCount > 0) results.push({ severity: "low", title: `${data.metadata.todoCount} TODO items found in docs`, detail: "Generated documentation contains placeholder items that need human review." });
    return normalize(results, "doc");
  }
  // Fallback
  return normalize(data.findings || data.issues || [], agentId);
}

// Finding categories for the review phase (reorganized from the 4 backend agents)
const FINDING_CATEGORIES = [
  { id: "code", name: "Code Quality", Icon: FileCode, color: "#8B5CF6" },
  { id: "security", name: "Security", Icon: Shield, color: "#D35C1A" },
  { id: "accessibility", name: "Accessibility", Icon: Eye, color: "#7C3AED" },
  { id: "docs", name: "Documentation & Compliance", Icon: ClipboardCheck, color: "#16864E" },
];

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
  const mapped = { code: [], security: [], accessibility: [], docs: [] };
  for (const [agentId, findings] of Object.entries(agentFindings)) {
    for (const f of findings) {
      if (agentId === "security") {
        // Split Agent 1 into code vs security
        if (isSecurityFinding(f)) mapped.security.push(f);
        else mapped.code.push(f);
      } else if (agentId === "accessibility") {
        mapped.accessibility.push(f);
      } else {
        // hecvat + documentation → docs
        mapped.docs.push(f);
      }
    }
  }
  return mapped;
}

// ═══════════════════════════════════════════════════════════
// DEMO / SIMULATION DATA
// ═══════════════════════════════════════════════════════════

const LOG_TEMPLATES = {
  security: [
    "[scan] Extracting 47 files from archive...",
    "[scan] Found package.json, requirements.txt — 2 dependency manifests",
    "[deps] Auditing 142 npm packages...",
    "[deps] WARN lodash@4.17.15 — prototype pollution (CVE-2020-8203)",
    "[deps] WARN axios@0.21.0 — SSRF vulnerability (CVE-2021-3749)",
    "[sast] Running static analysis on 23 source files...",
    "[sast] CRITICAL src/config.js:14 — hardcoded API key detected",
    "[sast] HIGH src/routes/api.js:42 — missing CSRF token validation",
    "[sast] MEDIUM src/db/queries.js:18 — potential SQL injection vector",
    "[secrets] Scanning for API keys, tokens, credentials...",
    "[secrets] CRITICAL .env committed to repository with production secrets",
    "[secrets] WARN src/config.js contains base64-encoded credential",
    "[owasp] Checking A01:Broken Access Control...",
    "[owasp] Checking A02:Cryptographic Failures...",
    "[owasp] Checking A03:Injection...",
    "[owasp] WARN A03 — unparameterized query in src/db/queries.js",
    "[owasp] Checking A07:Authentication Failures...",
    "[report] Compiling security findings — 2 critical, 3 high, 4 medium, 2 low",
  ],
  accessibility: [
    "[parse] Scanning 12 component files for rendered markup...",
    "[parse] Found 8 pages, 24 interactive components, 15 form elements",
    "[color] Analyzing color contrast ratios...",
    "[color] FAIL #999 on #fff — ratio 2.85:1, requires 4.5:1 (AA)",
    "[color] FAIL #B0B0B0 on #F5F5F5 — ratio 1.96:1 on secondary nav",
    "[color] PASS primary text #333 on #fff — ratio 12.63:1",
    "[aria] Checking ARIA roles and attributes...",
    "[aria] WARN 12 images missing alt attributes in Dashboard.jsx",
    "[aria] WARN 3 buttons with no accessible name in Toolbar.jsx",
    "[aria] PASS landmark roles correctly applied to layout",
    "[kbd] Simulating keyboard-only navigation...",
    "[kbd] FAIL modal does not trap focus — tab escapes to background",
    "[kbd] WARN skip-to-content link missing on main layout",
    "[kbd] PASS all interactive elements reachable via tab",
    "[sr] Screen reader simulation pass...",
    "[sr] WARN dynamic content updates not announced via aria-live",
    "[report] Compiling accessibility findings — 1 critical, 2 high, 3 medium, 2 low",
  ],
  hecvat: [
    "[data] Mapping data flow: input → processing → storage → output",
    "[data] Identified 3 data stores: PostgreSQL, Redis cache, S3 bucket",
    "[data] WARN no data retention policy documented",
    "[auth] Reviewing authentication implementation...",
    "[auth] Found: session-based auth with express-session",
    "[auth] WARN session secret loaded from environment — verify rotation policy",
    "[auth] No MFA implementation detected",
    "[encrypt] Checking encryption at rest and in transit...",
    "[encrypt] TLS configured for all external connections",
    "[encrypt] WARN database encryption at rest not confirmed in config",
    "[encrypt] WARN Redis connection not using TLS",
    "[privacy] Checking data handling practices...",
    "[privacy] No privacy policy endpoint detected",
    "[privacy] WARN user deletion/export capability not implemented (FERPA)",
    "[compliance] Mapping to HECVAT-Lite questionnaire...",
    "[compliance] 18/32 questions auto-answerable from codebase",
    "[report] Compiling HECVAT findings — 0 critical, 2 high, 4 medium, 3 low",
  ],
  documentation: [
    "[struct] Analyzing project structure...",
    "[struct] Detected: Node.js/Express backend, React frontend, PostgreSQL",
    "[struct] Entry points: server.js (API), src/index.jsx (client)",
    "[api] Extracting API surface...",
    "[api] Found 14 REST endpoints across 4 route files",
    "[api] 3 endpoints missing JSDoc annotations",
    "[guide] Generating user guide...",
    "[guide] Sections: Overview, Getting Started, Features, FAQ",
    "[guide] Writing docs/user-guide.md (estimated 1,200 words)",
    "[admin] Generating admin guide...",
    "[admin] Sections: Deployment, Configuration, Monitoring, Troubleshooting",
    "[admin] Writing docs/admin-guide.md (estimated 2,100 words)",
    "[report] Compiling consolidated findings report...",
    "[report] Aggregating 28 findings across 4 agents",
    "[report] Writing docs/findings-report.md",
    "[report] README.md is sparse — recommending expansion",
    "[done] Documentation generation complete — 3 documents written",
  ],
};

const DEMO_FINDINGS = {
  security: [
    { id: "sec-1", severity: "critical", title: "Hardcoded API key in source", file: "src/config.js", line: 14, detail: "Anthropic API key found in plaintext. Move to environment variables and rotate the exposed key immediately.", remediation: "Move to .env, add to .gitignore, rotate key in provider dashboard.", status: "open" },
    { id: "sec-2", severity: "critical", title: ".env file committed to repository", file: ".env", line: null, detail: "Production environment file with database credentials and API keys committed to version control.", remediation: "Remove from tracking with git rm --cached, add to .gitignore, rotate all credentials.", status: "open" },
    { id: "sec-3", severity: "high", title: "Missing CSRF protection on POST endpoints", file: "src/routes/api.js", line: 42, detail: "POST, PUT, and DELETE endpoints lack CSRF token validation. Vulnerable to cross-site request forgery.", remediation: "Add csurf middleware or implement double-submit cookie pattern.", status: "open" },
    { id: "sec-4", severity: "high", title: "Outdated lodash with prototype pollution", file: "package.json", line: null, detail: "lodash@4.17.15 has known prototype pollution vulnerability (CVE-2020-8203).", remediation: "Update to lodash@4.17.21 or later.", status: "open" },
    { id: "sec-5", severity: "high", title: "Potential SQL injection vector", file: "src/db/queries.js", line: 18, detail: "String concatenation used in SQL query construction instead of parameterized queries.", remediation: "Use parameterized queries or prepared statements for all database operations.", status: "open" },
    { id: "sec-6", severity: "medium", title: "Axios SSRF vulnerability", file: "package.json", line: null, detail: "axios@0.21.0 allows server-side request forgery (CVE-2021-3749).", remediation: "Update to axios@0.21.2 or later.", status: "open" },
    { id: "sec-7", severity: "medium", title: "No rate limiting on API endpoints", file: "src/server.js", line: null, detail: "Public API endpoints have no rate limiting, vulnerable to abuse and DoS.", remediation: "Add express-rate-limit middleware with appropriate thresholds.", status: "open" },
    { id: "sec-8", severity: "medium", title: "Permissive CORS configuration", file: "src/server.js", line: 8, detail: "CORS origin set to '*', allowing requests from any domain.", remediation: "Restrict to known domains: campus URLs and approved origins.", status: "open" },
    { id: "sec-9", severity: "low", title: "Console.log statements in production code", file: "src/utils/helpers.js", line: "8, 22, 45", detail: "Debug logging left in production code. May leak sensitive data to browser console.", remediation: "Remove or replace with a proper logging library with level controls.", status: "open" },
    { id: "sec-10", severity: "low", title: "Missing security headers", file: "src/server.js", line: null, detail: "No Helmet middleware — missing X-Content-Type-Options, X-Frame-Options, CSP headers.", remediation: "Add helmet middleware with appropriate security header configuration.", status: "open" },
    { id: "sec-11", severity: "medium", title: "No error boundary in React app", file: "src/index.jsx", line: null, detail: "No React error boundary component. Unhandled rendering errors crash the entire UI with no fallback.", remediation: "Add an ErrorBoundary wrapper at the app root with a user-friendly fallback UI.", status: "open" },
    { id: "sec-12", severity: "medium", title: "Unused dependencies in package.json", file: "package.json", line: null, detail: "6 packages imported in package.json are not referenced anywhere in the codebase, increasing bundle size and attack surface.", remediation: "Run 'npx depcheck' and remove unused packages.", status: "open" },
    { id: "sec-13", severity: "low", title: "Inconsistent error handling patterns", file: "src/routes/", line: null, detail: "Some routes use try/catch with proper error responses, others let exceptions propagate unhandled. Mixed async/callback patterns.", remediation: "Standardize on async/await with a shared error handler middleware.", status: "open" },
    { id: "sec-14", severity: "info", title: "No TypeScript or JSDoc type annotations", file: "src/", line: null, detail: "Entire codebase is untyped JavaScript. No JSDoc annotations on function signatures. Increases maintenance risk.", remediation: "Consider adding TypeScript or JSDoc annotations to critical paths.", status: "open" },
  ],
  accessibility: [
    { id: "a11y-1", severity: "critical", title: "Missing alt text on 12 images", file: "src/components/Dashboard.jsx", line: null, detail: "12 <img> elements without alt attributes. Screen readers cannot describe these images to users.", remediation: "Add descriptive alt text to all images. Use alt='' for decorative images.", status: "open" },
    { id: "a11y-2", severity: "high", title: "Color contrast ratio below 4.5:1", file: "src/styles/theme.css", line: 18, detail: "Text color #999 on #fff background has contrast ratio 2.85:1. WCAG AA requires 4.5:1 for normal text.", remediation: "Use #767676 or darker for text on white backgrounds.", status: "open" },
    { id: "a11y-3", severity: "high", title: "Secondary nav contrast failure", file: "src/styles/theme.css", line: 34, detail: "Navigation text #B0B0B0 on #F5F5F5 has ratio 1.96:1. Effectively invisible to low-vision users.", remediation: "Darken text to at least #757575 or darken background.", status: "open" },
    { id: "a11y-4", severity: "medium", title: "Form inputs missing associated labels", file: "src/components/Form.jsx", line: "24-38", detail: "15 form inputs without <label> elements or aria-label attributes.", remediation: "Add <label htmlFor='id'> or aria-label to all form controls.", status: "open" },
    { id: "a11y-5", severity: "medium", title: "Buttons without accessible names", file: "src/components/Toolbar.jsx", line: null, detail: "3 icon-only buttons have no accessible name. Screen readers announce them as 'button'.", remediation: "Add aria-label describing the button action.", status: "open" },
    { id: "a11y-6", severity: "medium", title: "Modal does not trap focus", file: "src/components/Modal.jsx", line: null, detail: "Tab key escapes the modal to background content. Keyboard users can interact with hidden elements.", remediation: "Implement focus trap using focus-trap-react or manual tab key handling.", status: "open" },
    { id: "a11y-7", severity: "low", title: "Missing skip-to-content link", file: "src/layouts/MainLayout.jsx", line: null, detail: "No skip navigation link present. Keyboard users must tab through entire header on every page.", remediation: "Add a visually hidden skip link as the first focusable element.", status: "open" },
    { id: "a11y-8", severity: "low", title: "Dynamic content not announced", file: "src/components/Notifications.jsx", line: null, detail: "Toast notifications and status updates not wrapped in aria-live regions.", remediation: "Add aria-live='polite' to notification container.", status: "open" },
  ],
  hecvat: [
    { id: "hec-1", severity: "high", title: "No data retention policy documented", file: "Architecture", line: null, detail: "No documented policy on data lifecycle — how long data is retained, when and how it's purged.", remediation: "Define and document data retention schedule. Implement automated purge for expired data.", status: "open" },
    { id: "hec-2", severity: "high", title: "No user data export/deletion capability", file: "Architecture", line: null, detail: "No mechanism for users to request data export or deletion. Required under FERPA for student data.", remediation: "Implement data export endpoint and account deletion workflow.", status: "open" },
    { id: "hec-3", severity: "medium", title: "Database encryption at rest not confirmed", file: "config/database.yml", line: null, detail: "Database configuration does not specify encryption at rest. Data may be stored unencrypted on disk.", remediation: "Enable encryption at rest in PostgreSQL config or use encrypted storage volumes.", status: "open" },
    { id: "hec-4", severity: "medium", title: "Redis connection without TLS", file: "src/config/redis.js", line: null, detail: "Redis client connects without TLS. Session data transmitted in plaintext on the network.", remediation: "Enable TLS on Redis connection. Use rediss:// protocol.", status: "open" },
    { id: "hec-5", severity: "medium", title: "No MFA implementation", file: "src/auth/", line: null, detail: "Single-factor authentication only. No multi-factor option available for elevated-privilege accounts.", remediation: "Implement MFA via campus SSO integration or TOTP for admin accounts.", status: "open" },
    { id: "hec-6", severity: "medium", title: "Backup and recovery plan absent", file: "Operations", line: null, detail: "No documented backup schedule, retention, or disaster recovery procedure.", remediation: "Document backup schedule, test recovery procedure, define RTO/RPO.", status: "open" },
    { id: "hec-7", severity: "low", title: "Incident response contacts not listed", file: "Documentation", line: null, detail: "No documented security incident response contacts or escalation path.", remediation: "Add IR contacts to admin guide and operational runbook.", status: "open" },
    { id: "hec-8", severity: "low", title: "Session secret rotation not documented", file: "src/config/session.js", line: null, detail: "Session secret loaded from environment but no rotation policy documented.", remediation: "Document rotation schedule and implement graceful secret rotation.", status: "open" },
    { id: "hec-9", severity: "low", title: "No privacy policy endpoint", file: "src/routes/", line: null, detail: "Application has no privacy policy page or endpoint for users to review data practices.", remediation: "Add a /privacy route with institutional privacy policy.", status: "open" },
  ],
  documentation: [
    { id: "doc-1", severity: "info", title: "User guide generated", file: "docs/user-guide.md", line: null, detail: "Plain-language guide covering tool purpose, access, features, and FAQ. ~1,200 words.", remediation: null, status: "complete" },
    { id: "doc-2", severity: "info", title: "Admin guide generated", file: "docs/admin-guide.md", line: null, detail: "Deployment, configuration, environment variables, monitoring, and troubleshooting. ~2,100 words.", remediation: null, status: "complete" },
    { id: "doc-3", severity: "info", title: "Findings report compiled", file: "docs/findings-report.md", line: null, detail: "Consolidated report of all agent findings with severity ratings, file references, and remediation steps.", remediation: null, status: "complete" },
    { id: "doc-4", severity: "low", title: "README.md is sparse", file: "README.md", line: null, detail: "Current README contains only project name. Should include setup, architecture overview, and usage.", remediation: "Expand README with installation steps, architecture diagram, and contributing guidelines.", status: "open" },
    { id: "doc-5", severity: "low", title: "3 API endpoints missing JSDoc", file: "src/routes/", line: null, detail: "Endpoints POST /api/users, PUT /api/settings, DELETE /api/sessions lack documentation.", remediation: "Add JSDoc comments with parameter types, descriptions, and response formats.", status: "open" },
  ],
};

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
  return (
    <div>
      <div onClick={() => isDir ? setOpen(!open) : onSelect?.(fullPath)}
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
      <div onClick={() => setExpanded(!expanded)} style={{ padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
        {expanded ? <ChevronDown size={14} color={C.textDim} /> : <ChevronRight size={14} color={C.textDim} />}
        <SevBadge severity={finding.severity} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.text }}>{finding.title}</span>
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

export default function CodeUpload({ toolId }) {
  const { toast } = useToast();
  const [tool, setTool] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [file, setFile] = useState(null);
  const [runId, setRunId] = useState(null);
  const [starting, setStarting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // { loaded, total } or null

  // Phase: upload | running | review
  const [phase, setPhase] = useState("upload");
  const [agentStates, setAgentStates] = useState({ security: "idle", accessibility: "idle", hecvat: "idle", documentation: "idle" });
  const [agentProgress, setAgentProgress] = useState({ security: 0, accessibility: 0, hecvat: 0, documentation: 0 });
  const [agentLogs, setAgentLogs] = useState({ security: [], accessibility: [], hecvat: [], documentation: [] });
  const [expandedAgent, setExpandedAgent] = useState("security");

  // Review state
  const [findings, setFindings] = useState({});
  const [sevFilter, setSevFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [viewMode, setViewMode] = useState("summary");
  const [selectedFile, setSelectedFile] = useState(null);
  const [submitted, setSubmitted] = useState(null);

  // Demo mode
  const [isDemo, setIsDemo] = useState(false);

  // SSE
  const { events, done: sseDone, failed: sseFailed, connectionLost } = usePipelineStream(runId);
  const [pipelineError, setPipelineError] = useState(null);

  // Load tool and check for active pipeline runs (skip for demo mode)
  useEffect(() => {
    if (toolId === "demo") {
      setTool({ name: "um-course-advisor-v2.1", track: 3 });
      setLoading(false);
      return;
    }
    setLoading(true);
    getTool(toolId)
      .then(data => {
        setTool(data.tool);
        // Check for active/queued pipeline runs to resume
        const runs = data.runs || [];
        const activeRun = runs.find(r => r.status === "running" || r.status === "queued");
        const completedRun = runs.find(r => r.status === "completed");
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
          }).catch(() => {});
        } else if (completedRun && data.tool.status === "under_review") {
          setRunId(completedRun.id);
          // Fetch findings from the completed run
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
            setAgentStates({ security: "complete", accessibility: "complete", hecvat: "complete", documentation: "complete" });
            setAgentProgress({ security: 1, accessibility: 1, hecvat: 1, documentation: 1 });
            setPhase("review");
          }).catch(() => setPhase("review"));
        }
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
            logs.push(`[result] ${s.total} findings: ${s.critical} critical, ${s.high} high, ${s.medium} medium, ${s.low} low`);
            if (s.topFindings) for (const f of s.topFindings.slice(0, 3)) {
              logs.push(`  ${(f.severity || "").toUpperCase()}: ${f.title}`);
            }
          } else if (s && s.nonNegotiable != null) {
            logs.push(`[result] ${s.total} HECVAT questions assessed, ${s.answeredFromCode} from code`);
            if (s.nonNegotiable > 0) logs.push(`  CRITICAL: ${s.nonNegotiable} non-negotiable failures`);
            if (s.highRisk > 0) logs.push(`  HIGH: ${s.highRisk} high-risk findings`);
          } else if (s && s.docs) {
            logs.push(`[result] Generated: ${s.docs.join(", ")}`);
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
          const maxPasses = (agentId === "security" || agentId === "accessibility") ? 5 : 1;
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
      setAgentStates({ security: "complete", accessibility: "complete", hecvat: "complete", documentation: "complete" });
      setAgentProgress({ security: 1, accessibility: 1, hecvat: 1, documentation: 1 });
      getReport(runId)
        .then(data => {
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

  // Demo simulation
  function startDemo() {
    setIsDemo(true);
    setTool({ name: "um-course-advisor-v2.1", track: 3 });
    setPhase("running");
    AGENTS.forEach((agent, idx) => {
      setTimeout(() => {
        setAgentStates(p => ({ ...p, [agent.id]: "running" }));
        setExpandedAgent(agent.id);
        const logLines = LOG_TEMPLATES[agent.id];
        const dur = 4000 + Math.random() * 3000;
        const interval = 60;
        let elapsed = 0;
        let logIdx = 0;
        const timer = setInterval(() => {
          elapsed += interval;
          const pct = Math.min(elapsed / dur, 1);
          setAgentProgress(p => ({ ...p, [agent.id]: pct }));
          const targetLogIdx = Math.floor(pct * logLines.length);
          while (logIdx < targetLogIdx && logIdx < logLines.length) {
            const line = logLines[logIdx];
            setAgentLogs(p => ({ ...p, [agent.id]: [...p[agent.id], line] }));
            logIdx++;
          }
          if (pct >= 1) {
            clearInterval(timer);
            while (logIdx < logLines.length) {
              const line = logLines[logIdx];
              setAgentLogs(p => ({ ...p, [agent.id]: [...p[agent.id], line] }));
              logIdx++;
            }
            setAgentStates(p => ({ ...p, [agent.id]: "complete" }));
            setFindings(p => ({ ...p, [agent.id]: DEMO_FINDINGS[agent.id] }));
          }
        }, interval);
      }, idx * 1200);
    });
  }

  // Transition to review when all agents complete (demo mode)
  useEffect(() => {
    if (isDemo && phase === "running" && Object.values(agentStates).every(s => s === "complete")) {
      setTimeout(() => setPhase("review"), 800);
    }
  }, [isDemo, agentStates, phase]);

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
    medium: allFindings.filter(f => f.severity === "medium").length,
    low: allFindings.filter(f => f.severity === "low").length,
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
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textMid }}>
              <span style={{ fontWeight: 700, color: TRACK_COLORS[4] }}>{stats.open}</span> open
              <span style={{ color: C.border }}>·</span>
              <span style={{ fontWeight: 700, color: TRACK_COLORS[1] }}>{stats.resolved}</span> resolved
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

          <div onDragOver={e => e.preventDefault()} onDrop={handleFile}
            style={{ padding: 56, borderRadius: 12, border: `2px dashed ${file ? C.accent : C.border}`,
              background: file ? C.accentSoft : C.surface, textAlign: "center", cursor: "pointer", transition: "all .2s", marginBottom: 24 }}
            onClick={() => document.getElementById("zipInput")?.click()}>
            <input id="zipInput" type="file" accept=".zip" style={{ display: "none" }} onChange={handleFile} />
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
          </div>

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
              <div style={{ width: "100%", maxWidth: 400 }}>
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
            <button onClick={startDemo}
              style={{ padding: "10px 24px", borderRadius: 8, border: `1.5px solid ${C.border}`, cursor: "pointer",
                background: "transparent", color: C.textMid, fontSize: 13, fontWeight: 600,
                fontFamily: "'DM Sans', sans-serif", display: "inline-flex", alignItems: "center", gap: 6 }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMid; }}>
              <Terminal size={14} /> Simulate Demo
            </button>
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

          {pipelineError && (
            <div style={{ padding: "14px 16px", borderRadius: 8, background: "rgba(201,48,44,0.07)", border: `1px solid rgba(201,48,44,0.2)`, marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: TRACK_COLORS[4], marginBottom: 4 }}>Pipeline Failed</div>
              <div style={{ fontSize: 13, color: C.text, marginBottom: 10 }}>{pipelineError}</div>
              <button onClick={() => { setPipelineError(null); setRunId(null); setPhase("upload"); setAgentStates({ security: "idle", accessibility: "idle", hecvat: "idle", documentation: "idle" }); setAgentProgress({ security: 0, accessibility: 0, hecvat: 0, documentation: 0 }); setAgentLogs({ security: [], accessibility: [], hecvat: [], documentation: [] }); }}
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
              { label: "Medium", count: stats.medium, color: SEV.medium.color },
              { label: "Low", count: stats.low, color: SEV.low.color },
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
                          {["critical","high","medium","low","info"].map(sev => {
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
          {!submitted ? (
            <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
              <button onClick={async () => {
                  if (isDemo) { navigate("/registry"); return; }
                  const newStatus = (tool?.track || 3) <= 2 ? "active" : "under_review";
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
              {runId && (
                <button onClick={() => navigate(`/tool/${toolId}/report/${runId}`)}
                  style={{ padding: "13px 24px", borderRadius: 10, border: `1.5px solid ${C.border}`, cursor: "pointer",
                    background: "transparent", color: C.textMid, fontSize: 14, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>
                  View Full Report
                </button>
              )}
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
                    <strong>{stats.critical + stats.high}</strong> critical/high findings and <strong>{stats.medium}</strong> medium findings were identified.
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
        </div>
      )}
    </div>
  );
}
