export const APP_META = {
  productName: "AI Tool Intake",
  shortName: "AIF",
  edition: "Higher Education Edition",
  institutionName: "",  // loaded from /api/config at runtime
  summary: "Guide builders through intake, route risk proportionally, and produce decision-ready review artifacts.",
  frameworkVersion: "2026.1",
};

export const C = {
  bg: "var(--bg)",
  surface: "var(--surface)",
  surfaceAlt: "var(--surface-alt)",
  surfaceHover: "var(--surface-hover)",
  border: "var(--border)",
  borderFocus: "var(--border-focus)",
  text: "var(--text)",
  textMid: "var(--text-mid)",
  textDim: "var(--text-dim)",
  accent: "var(--accent)",
  accentSoft: "var(--accent-soft)",
  accentHover: "var(--accent-hover)",
  accent20: "var(--accent-20)",
  accent25: "var(--accent-25)",
  accent30: "var(--accent-30)",
  accent35: "var(--accent-35)",
  accent40: "var(--accent-40)",
  success: "var(--success)",
  successBg: "var(--success-bg)",
  warning: "var(--warning)",
  warningBg: "var(--warning-bg)",
  danger: "var(--danger)",
  dangerBg: "var(--danger-bg)",
  gold: "var(--gold)",
  gold20: "var(--gold-20)",
};

export const TRACK_COLORS = { 1: "#14754A", 2: "#5C4706", 3: "#C05E1A", 4: "#B22B27" };
export const TRACK_LABELS = { 1: "Register & Go", 2: "Self-Certify", 3: "IT Review", 4: "Formal Project" };

export const WEIGHT_MATRIX = {
  "public-site":   { security: 4, accessibility: 4, dataSensitivity: 3, blastRadius: 3, autonomy: 1, comprehension: 2, maintenance: 3 },
  "internal-app":  { security: 3, accessibility: 3, dataSensitivity: 4, blastRadius: 2, autonomy: 1, comprehension: 2, maintenance: 3 },
  "script-api":    { security: 3, accessibility: 0, dataSensitivity: 3, blastRadius: 2, autonomy: 2, comprehension: 2, maintenance: 3 },
  "ai-agent":      { security: 3, accessibility: 1, dataSensitivity: 3, blastRadius: 4, autonomy: 4, comprehension: 4, maintenance: 3 },
  "data-pipeline": { security: 3, accessibility: 0, dataSensitivity: 4, blastRadius: 2, autonomy: 2, comprehension: 2, maintenance: 3 },
  "other":         { security: 3, accessibility: 2, dataSensitivity: 3, blastRadius: 2, autonomy: 1, comprehension: 2, maintenance: 3 },
};

export const AGENTS = [
  { id: "security", name: "Code / Security", color: "#F97316", desc: "Static analysis, dependency audit, secrets scan, OWASP checks" },
  { id: "accessibility", name: "Accessibility", color: "#8B5CF6", desc: "WCAG 2.2 AA compliance, Section 508, screen reader audit" },
  { id: "qa", name: "QA / Bug Detection", color: "#06B6D4", desc: "Logic bugs, error handling, async issues, edge cases, failure modes" },
  { id: "documentation", name: "Documentation", color: "#22C55E", desc: "User guide, admin guide, findings report, HECVAT assessment" },
];

export const SEVERITY_CONFIG = {
  critical: { color: "#B22B27", bg: "rgba(178,43,39,0.08)", label: "CRITICAL" },
  high:     { color: "#A34414", bg: "rgba(163,68,20,0.08)", label: "HIGH" },
  warning:  { color: "#5C4706", bg: "rgba(122,90,7,0.08)", label: "WARNING" },
  medium:   { color: "#5C4706", bg: "rgba(122,90,7,0.08)", label: "MEDIUM" },
  low:      { color: "#1A6B4B", bg: "rgba(26,107,75,0.08)", label: "LOW" },
  info:     { color: "#546070", bg: "rgba(84,96,112,0.06)", label: "INFO" },
};

export const DIMENSION_LABELS = {
  security: "Security",
  accessibility: "Accessibility",
  dataSensitivity: "Data Sensitivity",
  blastRadius: "Blast Radius",
  autonomy: "Autonomy",
  comprehension: "Comprehension",
  maintenance: "Maintenance",
};

export const DIMENSION_SHORT = {
  security: "SEC",
  accessibility: "A11Y",
  dataSensitivity: "DATA",
  blastRadius: "BLAST",
  autonomy: "AUTO",
  comprehension: "COMP",
  maintenance: "MAINT",
};

/** Preview-only: backend recomputes authoritatively on submit via scoring.js. */
function computeDimensionScores(a) {
  const s = { security: 0, accessibility: 0, dataSensitivity: 0, blastRadius: 0, autonomy: 0, comprehension: 0, maintenance: 0 };
  if (a.q5 === "public-noauth") s.security = 3;
  else if (a.q5 === "public-auth") s.security = 2;
  else if (a.q5 === "campus-vpn") s.security = 1;
  else if (a.q5 === "undetermined") s.security = 2;
  if (a.q6 === "no-auth" || a.q6 === "custom-auth") s.security = Math.min(s.security + 1, 3);
  if (a.q5 === "public-noauth" || a.q5 === "public-auth") s.accessibility = 3;
  else if (a.q1 === "internal-app") s.accessibility = 2;
  const dt = a.q10 || [];
  if (dt.some(d => ["hipaa","irb","export","tribal"].includes(d))) s.dataSensitivity = 3;
  else if (dt.some(d => ["ferpa","hr","payment","credentials","behavioral"].includes(d))) s.dataSensitivity = 2;
  else if (dt.includes("internal")) s.dataSensitivity = 1;
  if (a.q9 === "no") s.dataSensitivity = 0;
  const u = a.q3 || [];
  if (u.some(x => ["public","external"].includes(x))) s.blastRadius = 3;
  else if (u.includes("students") || u.includes("department")) s.blastRadius = 2;
  else if (u.includes("team")) s.blastRadius = 1;
  if (a.q8 === "500+") s.blastRadius = Math.min(s.blastRadius + 1, 3);
  if (a.q21 === "no") s.autonomy = Math.min(s.autonomy + 2, 3);
  else if (a.q21 === "partial") s.autonomy = Math.min(s.autonomy + 1, 3);
  if (a.q20 && a.q20.length > 10) s.autonomy = Math.min(s.autonomy + 1, 3);
  if (!a.q19 || a.q19.length < 20) s.comprehension = 3;
  else if (a.q19.length < 80) s.comprehension = 2;
  else if (a.q19.length < 200) s.comprehension = 1;
  let m = 0;
  if (a.q15 === "no-vc") m += 1;
  if (a.q16 === "nobody" || a.q16 === "stop") m += 1;
  if (a.q17 === "third-party-dep") m += 0.5;
  if (a.q18 === "only-me" || a.q18 === "unknown") m += 0.5;
  s.maintenance = Math.min(Math.round(m), 3);
  return s;
}

function checkEscalations(a) {
  const e = [];
  const dt = a.q10 || [];
  if (dt.some(d => ["hipaa","irb","export","tribal"].includes(d))) e.push("Regulated data (HIPAA/IRB/Export/Tribal)");
  if (dt.includes("ferpa") && (a.q5 === "public-noauth" || (a.q5 === "public-auth" && a.q6 !== "sso"))) e.push("FERPA + public-facing deployment");
  if ((a.q11 || []).includes("personal")) e.push("Institutional data in personal accounts");
  if (a.q12 === "no-dpa" || a.q12 === "unknown-dpa") e.push("AI model without approved DPA");
  if (a.q6 === "custom-auth") e.push("Auth outside campus SSO");
  if (a.q15 === "no-vc") e.push("No version control");
  if (a.q21 === "no" && (a.q3 || []).includes("students")) e.push("Students unaware of AI");
  return e;
}

function checkFloors(a) {
  const f = [];
  const dt = a.q10 || [];
  if (dt.includes("ferpa") && a.q5 === "public-auth" && a.q6 === "sso") {
    f.push({ track: 3, reason: "FERPA data on internet-reachable SSO deployment" });
  }
  return f;
}

export function computeTrack(a) {
  const key = a.q1 || "other";
  const w = WEIGHT_MATRIX[key] || WEIGHT_MATRIX["other"];
  const d = computeDimensionScores(a);
  const esc = checkEscalations(a);
  const floors = checkFloors(a);
  let total = 0, max = 0;
  for (const k of Object.keys(d)) { total += d[k] * (w[k] || 0); max += 3 * (w[k] || 0); }
  const pct = max > 0 ? total / max : 0;
  const floorTrack = floors.reduce((m, f) => Math.max(m, f.track), 1);
  let track;
  if (esc.length > 0 || pct >= 0.65) track = 4;
  else if (pct >= 0.42) track = 3;
  else if (pct >= 0.22) track = 2;
  else track = 1;
  if (esc.length === 0) track = Math.max(track, floorTrack);
  return { track, total, max, pct, dims: d, weights: w, escalations: esc, floors };
}

export const STATUS_META = {
  draft: { label: "Draft", color: "#6B5A2A", bg: "rgba(107,90,42,0.1)" },
  pending: { label: "Pending", color: "#1A6B4B", bg: "rgba(26,107,75,0.08)" },
  in_progress: { label: "In Progress", color: "#A34414", bg: "rgba(163,68,20,0.08)" },
  active: { label: "Active", color: "#14754A", bg: "rgba(20,117,74,0.08)" },
  under_review: { label: "Under Review", color: "#5C4706", bg: "rgba(122,90,7,0.08)" },
  approved: { label: "Approved", color: "#14754A", bg: "rgba(20,117,74,0.08)" },
  changes_requested: { label: "Changes Requested", color: "#5C4706", bg: "rgba(122,90,7,0.08)" },
  suspended: { label: "Suspended", color: "#B22B27", bg: "rgba(178,43,39,0.08)" },
  retired: { label: "Retired", color: "#546070", bg: "rgba(84,96,112,0.06)" },
  running: { label: "Running", color: "#1A6B4B", bg: "rgba(26,107,75,0.08)" },
  completed: { label: "Completed", color: "#14754A", bg: "rgba(20,117,74,0.08)" },
  failed: { label: "Failed", color: "#B22B27", bg: "rgba(178,43,39,0.08)" },
  queued: { label: "Queued", color: "#546070", bg: "rgba(84,96,112,0.06)" },
};

export const ROUTE_META = {
  welcome: {
    label: "Welcome",
    title: "Welcome",
    description: "Get started with the AI Tool Intake process.",
  },
  registry: {
    label: "Registry",
    title: "Registry",
    description: "Track submissions, review posture, and next actions.",
  },
  intake: {
    label: "Submit Tool",
    title: "New Submission",
    description: "Answer intake questions and submit code for review.",
  },
  "intake-edit": {
    label: "Resume Draft",
    title: "Resume Draft",
    description: "Return to an existing intake.",
  },
  detail: {
    label: "Tool Detail",
    title: "Tool Detail",
    description: "Review ownership, current track, run history.",
  },
  pipeline: {
    label: "Pipeline",
    title: "Pipeline Progress",
    description: "Track analysis progress.",
  },
  report: {
    label: "Report",
    title: "Final Report",
    description: "Summarize findings and required actions.",
  },
  agents: {
    label: "Agents",
    title: "Agent Pipeline",
    description: "How the four AI agents analyze your code.",
  },
  framework: {
    label: "Framework",
    title: "Framework Reference",
    description: "Governance model, scoring rubric, and policy.",
  },
  upload: {
    label: "Upload",
    title: "Code Upload",
    description: "Upload code and run the review pipeline.",
  },
  review: {
    label: "Code Review",
    title: "Code Review",
    description: "Review pipeline findings for a submitted tool.",
  },
  admin: {
    label: "Admin",
    title: "Admin Dashboard",
    description: "System overview and management.",
  },
};

export function parsePossiblyStringArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
