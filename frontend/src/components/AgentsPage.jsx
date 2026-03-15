import { useState, useEffect, useRef } from "react";
import { Shield, Eye, ClipboardCheck, FileText, GitBranch, ExternalLink, Cpu, Layers, ChevronRight, Zap, Users, Terminal, Brain, Github } from "lucide-react";
import { C } from "../constants.js";
import { useAuth } from "../hooks/useAuth.jsx";

const AGENT_DETAILS = [
  {
    id: "code-security",
    num: 1,
    name: "Code & Security Analysis",
    Icon: Shield,
    color: "#A34414",
    type: "Multi-model (5 passes + synthesis + stack deep dive)",
    desc: "Performs a comprehensive 10-section security and code quality audit of the entire codebase. Each of 5 AI models independently reviews the code using the same evaluation rubric, then Claude synthesizes their findings with dispute resolution. A second Claude pass runs stack-specific security checklists tailored to the detected frameworks.",
    sections: [
      "Technology inventory (languages, frameworks, packages)",
      "External services and API integrations",
      "Data operations and classification (PII, FERPA, HIPAA)",
      "Authentication and SSO analysis",
      "Secrets and credential detection",
      "AI/ML usage patterns and data transmission",
      "MCP server security and agentic patterns",
      "Escalation signal detection (7 conditions)",
      "7-dimension scoring signals (0-3 each)",
      "Prioritized findings with file:line evidence",
      "Stack-specific deep dive (React, Express, Spring, Django, Phoenix, Postgres, MongoDB, AI/ML, Docker)",
    ],
    tools: [
      { name: "Snyk Agent Scan", desc: "Automated MCP config and SKILL.md security scanning", url: "https://github.com/snyk/snyk-agent-scan" },
    ],
    inspirations: [
      { name: "Shannon", desc: "AI-powered security analysis agent by Keygraph", url: "https://github.com/KeygraphHQ/shannon" },
      { name: "Semgrep", desc: "Static analysis patterns and OWASP rule design", url: "https://github.com/semgrep/semgrep" },
      { name: "TruffleHog", desc: "Secrets detection methodology", url: "https://github.com/trufflesecurity/trufflehog" },
      { name: "Scorecard", desc: "Supply chain security checks for open source projects", url: "https://github.com/ossf/scorecard" },
      { name: "Bearer", desc: "Code security and data flow analysis patterns", url: "https://github.com/Bearer/bearer" },
    ],
  },
  {
    id: "accessibility",
    num: 2,
    name: "Accessibility Audit",
    Icon: Eye,
    color: "#7C3AED",
    type: "Multi-model (5 passes + synthesis)",
    desc: "Performs a comprehensive WCAG 2.2 Level AA audit across the entire frontend codebase. Five models independently evaluate every component, template, and stylesheet against accessibility criteria, then Claude synthesizes with dispute resolution.",
    sections: [
      "Semantic HTML structure and landmarks",
      "ARIA roles, states, and properties",
      "Keyboard navigation and focus management",
      "Color contrast ratios (text and non-text)",
      "Form labeling and error handling",
      "Image and media alternatives",
      "Dynamic content and live regions",
      "Modal and dialog accessibility",
      "Responsive design and reflow",
      "Estimated WCAG conformance level",
    ],
    tools: [],
    inspirations: [
      { name: "accessibility-agents", desc: "Community Access multi-agent accessibility review", url: "https://github.com/Community-Access/accessibility-agents" },
      { name: "ai-agent-a11y-reviewer", desc: "AI agent for automated accessibility auditing", url: "https://github.com/guillempuche/ai-agent-a11y-accessibility-reviewer" },
      { name: "axe-core", desc: "WCAG rule definitions and testing methodology", url: "https://github.com/dequelabs/axe-core" },
      { name: "Pa11y", desc: "Automated accessibility testing patterns", url: "https://github.com/pa11y/pa11y" },
      { name: "Lighthouse", desc: "Accessibility audit scoring approach", url: "https://github.com/GoogleChrome/lighthouse" },
      { name: "WCAG 2.2 Specification", desc: "W3C Web Content Accessibility Guidelines", url: "https://www.w3.org/TR/WCAG22/" },
    ],
  },
  {
    id: "qa",
    num: 3,
    name: "QA / Bug Detection",
    Icon: ClipboardCheck,
    color: "#06B6D4",
    type: "Multi-model (5 passes + synthesis)",
    desc: "Finds logic bugs, correctness issues, and quality problems that security analysis doesn't cover. Five AI models independently review the code for null handling, error paths, async issues, edge cases, type safety, resource management, logic errors, API contract violations, state management, and failure modes. Claude synthesizes with convergence-based confidence.",
    sections: [
      "Null/undefined handling and missing checks",
      "Error handling gaps and silent failures",
      "Async/concurrency bugs and race conditions",
      "Edge cases and boundary conditions",
      "Type safety and coercion bugs",
      "Resource management (leaks, cleanup)",
      "Logic errors and incorrect conditions",
      "API contract violations (frontend/backend)",
      "State management issues",
      "Failure mode analysis per feature",
    ],
    tools: [],
    inspirations: [
      { name: "SonarQube", desc: "Static analysis bug detection patterns", url: "https://github.com/SonarSource/sonarqube" },
      { name: "ESLint", desc: "JavaScript linting rules for correctness", url: "https://github.com/eslint/eslint" },
      { name: "TypeScript", desc: "Type safety and null checking patterns", url: "https://github.com/microsoft/TypeScript" },
    ],
  },
  {
    id: "documentation",
    num: 4,
    name: "Documentation Generation",
    Icon: FileText,
    color: "#22C55E",
    type: "3 parallel passes (Gemini + GLM-5 + Claude, reads Agent 1-3 output)",
    desc: "Reads the codebase and all prior agent outputs to generate three production-ready documents plus a HECVAT 4.15 Lite self-assessment. Three models run in parallel: Gemini 3.1 Pro produces the User Guide and Admin Guide, GLM-5 handles the HECVAT self-assessment, and Claude produces the Compliance Summary. Outputs are converted from Markdown to .docx via Pandoc; HECVAT fills the official EDUCAUSE Excel template.",
    sections: [
      "USER_GUIDE.md / .docx — end-user documentation (Gemini 3.1 Pro)",
      "ADMIN_GUIDE.md / .docx — deployment, configuration, operations (Gemini 3.1 Pro)",
      "COMPLIANCE_SUMMARY.md / .docx — security posture, WCAG status, QA findings (Claude Opus 4.6)",
      "HECVAT 4.15 Lite — 87 critical questions, XLSX export (GLM-5)",
      "TODO markers for missing information",
      "Cross-references to agent findings",
    ],
    tools: [
      { name: "Pandoc", desc: "Markdown to DOCX conversion", url: "https://github.com/jgm/pandoc" },
      { name: "Notion API", desc: "User Guide and Admin Guide auto-published to IT knowledge base", url: "https://developers.notion.com" },
    ],
    inspirations: [
      { name: "ai-doc-gen", desc: "Multi-agent concurrent documentation generation", url: "https://github.com/divar-ir/ai-doc-gen" },
      { name: "awesome-claude-code-subagents", desc: "Claude Code subagent patterns for doc generation", url: "https://github.com/VoltAgent/awesome-claude-code-subagents" },
      { name: "readme-ai", desc: "Automated README generation from codebases", url: "https://github.com/eli64s/readme-ai" },
      { name: "JSDoc", desc: "JavaScript API documentation extraction", url: "https://github.com/jsdoc/jsdoc" },
      { name: "pdoc", desc: "Python API documentation auto-generation", url: "https://github.com/mitmproxy/pdoc" },
    ],
  },
];

const CLI_TOOLS = [
  { name: "Codex CLI", model: "GPT-5.4", provider: "OpenAI", desc: "Full filesystem access, sandbox mode, autonomous code exploration", url: "https://github.com/openai/codex",
    rationale: "Strongest at structured reasoning and step-by-step code analysis. Excels at identifying logical vulnerabilities and complex data flows." },
  { name: "opencode", model: "MiniMax M2.5", provider: "MiniMax via OpenRouter", desc: "Large-context reasoning with agentic coding capabilities", url: "https://github.com/nicholasq/opencode",
    rationale: "Strong at structured analysis and cross-file reasoning. Replaces Gemini 2.5 Pro in testing rotation." },
  { name: "opencode", model: "MiMo-V2-Flash", provider: "Xiaomi via OpenRouter", desc: "Fast reasoning model optimized for code and math", url: "https://github.com/nicholasq/opencode",
    rationale: "Lightweight flash model with strong code comprehension. Replaces Grok 3 Fast in testing rotation." },
  { name: "opencode", model: "Kimi K2", provider: "Moonshot via OpenRouter", desc: "Mixture-of-experts architecture with agentic coding", url: "https://github.com/nicholasq/opencode",
    rationale: "1T-parameter MoE architecture provides a fundamentally different analytical lens. Strong at identifying edge cases in authentication and data handling." },
  { name: "opencode", model: "GLM-5", provider: "Zhipu via OpenRouter", desc: "Agent-optimized model with deep code understanding", url: "https://github.com/nicholasq/opencode",
    rationale: "Open-source model designed for agent workflows. Replaces Qwen3 Coder in testing rotation." },
  { name: "Gemini CLI", model: "Gemini 3.1 Pro", provider: "Google", role: "docs", desc: "Full filesystem access, long-context document generation", url: "https://github.com/google-gemini/gemini-cli",
    rationale: "Used for Agent 4 documentation generation (User Guide + Admin Guide). Excels at long-form structured output with deep codebase context." },
  { name: "Claude Code", model: "Claude Opus 4.6", provider: "Anthropic", role: "synthesis", desc: "Synthesis, dispute resolution, compliance summary generation", url: "https://github.com/anthropics/claude-code",
    rationale: "Synthesizes multi-model analysis (Agents 1-3) and generates the Compliance Summary (Agent 4). Re-reads disputed files to resolve disagreements. Selected for strongest reasoning and nuanced judgment." },
];

const FRAMEWORKS = [
  { name: "NIST AI RMF", desc: "AI Risk Management Framework", url: "https://www.nist.gov/artificial-intelligence/ai-risk-management-framework" },
  { name: "NIST CSF 2.0", desc: "Cybersecurity Framework", url: "https://www.nist.gov/cyberframework" },
  { name: "WCAG 2.2", desc: "Web Content Accessibility Guidelines (W3C)", url: "https://www.w3.org/TR/WCAG22/" },
  { name: "OWASP Top 10", desc: "Web Application Security Risks", url: "https://owasp.org/www-project-top-ten/" },
  { name: "EDUCAUSE HECVAT", desc: "Higher Ed Vendor Assessment Toolkit", url: "https://www.educause.edu/hecvat" },
  { name: "ITIL 4", desc: "Change Management framework", url: "https://www.axelos.com/certifications/itil-service-management" },
];

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "convergence", label: "Multi-Model Convergence" },
  { id: "agent-1", label: "Agent 1: Code & Security" },
  { id: "stack-dive", label: "Stack Deep Dive" },
  { id: "agent-2", label: "Agent 2: Accessibility" },
  { id: "agent-3", label: "Agent 3: QA / Bugs" },
  { id: "agent-4", label: "Agent 4: Documentation" },
  { id: "why-models", label: "Why These Models" },
  { id: "cli-tools", label: "CLI Tools" },
  { id: "standards", label: "Standards & Frameworks" },
];

function ExtLink({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      style={{ color: C.accent, textDecoration: "underline", display: "inline-flex", alignItems: "center", gap: 4 }}>
      {children} <ExternalLink size={11} />
    </a>
  );
}

function PipelineDiagram({ onScrollTo }) {
  const models = [
    { label: "Pass 1", name: "GPT-5.4" },
    { label: "Pass 2", name: "MiniMax M2.5" },
    { label: "Pass 3", name: "MiMo-V2" },
    { label: "Pass 4", name: "Kimi K2" },
    { label: "Pass 5", name: "GLM-5" },
  ];

  const arrow = (label) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "2px 0" }}>
      <div style={{ width: 2, height: label ? 10 : 14, background: C.border }} />
      {label && (
        <div style={{ fontSize: 9, color: C.textDim, fontFamily: "'JetBrains Mono', monospace",
          padding: "2px 10px", margin: "3px 0", background: C.surface,
          borderRadius: 4, border: `1px solid ${C.border}` }}>{label}</div>
      )}
      <div style={{ width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent",
        borderTop: `5px solid ${C.textDim}` }} />
    </div>
  );

  const nodeBase = {
    background: C.bg, borderRadius: 12,
    padding: "14px 20px", width: "100%", maxWidth: 540,
  };

  const modelChips = (
    <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
      {models.map((m, i) => (
        <div key={i} style={{ flex: 1, padding: "5px 2px", borderRadius: 6, background: C.surface,
          border: `1px solid ${C.border}`, textAlign: "center" }}>
          <div style={{ fontSize: 8, color: C.textDim, fontFamily: "'JetBrains Mono', monospace" }}>{m.label}</div>
          <div style={{ fontSize: 9, color: C.text, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", marginTop: 1 }}>{m.name}</div>
        </div>
      ))}
    </div>
  );

  const synthBar = (detail) => (
    <>
      <div style={{ height: 1, background: `linear-gradient(90deg, transparent, ${C.border}, transparent)`, margin: "6px 0" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.accent }} />
        <span style={{ fontSize: 10, color: C.accent, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>Claude Synthesis</span>
        <span style={{ fontSize: 9, color: C.textDim }}>&middot; {detail}</span>
      </div>
    </>
  );

  const typeBadge = (label) => (
    <span style={{ fontSize: 9, color: C.textDim, fontFamily: "'JetBrains Mono', monospace", marginLeft: "auto",
      padding: "2px 6px", border: `1px solid ${C.border}`, borderRadius: 4 }}>{label}</span>
  );

  function agentNode(num, name, color, type, children) {
    return (
      <div role="button" tabIndex={0} onClick={() => onScrollTo(`agent-${num}`)}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onScrollTo(`agent-${num}`); } }}
        aria-label={`Scroll to Agent ${num}: ${name}`}
        style={{ ...nodeBase, cursor: "pointer",
        border: `1px solid ${C.border}`, borderLeft: `3px solid ${color}`, transition: "background .15s" }}
        onMouseEnter={e => e.currentTarget.style.background = C.surfaceHover}
        onMouseLeave={e => e.currentTarget.style.background = C.bg}
        onFocus={e => e.currentTarget.style.background = C.surfaceHover}
        onBlur={e => e.currentTarget.style.background = C.bg}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: children ? 10 : 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
            color, background: `${color}15`, padding: "2px 8px", borderRadius: 4 }}>AGENT {num}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{name}</span>
          {typeBadge(type)}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div style={{
      background: C.surfaceAlt, border: `1px solid ${C.border}`,
      borderRadius: 16, padding: "28px 24px", marginBottom: 32,
    }}>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, letterSpacing: 1.5,
          textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>
          Pipeline Architecture
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.text, letterSpacing: -0.3 }}>
          How Your Code Gets Reviewed
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        {/* Upload */}
        <div style={{ ...nodeBase, textAlign: "center", border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Codebase Submission</div>
          <div style={{ fontSize: 11, color: C.textMid, marginTop: 2 }}>ZIP upload &middot; extracted &amp; staged for analysis</div>
        </div>

        {arrow()}

        {/* Agent 1 */}
        {agentNode(1, "Code & Security", "#D35C1A", "MULTI-MODEL", <>
          {modelChips}
          {synthBar("3+ agree = confirmed \u00b7 1\u20132 = potential")}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 6 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#D35C1A" }} />
            <span style={{ fontSize: 10, color: "#D35C1A", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>Stack Deep Dive</span>
            <span style={{ fontSize: 9, color: C.textDim }}>&middot; framework-specific checklists</span>
          </div>
        </>)}

        {arrow()}

        {/* Agent 2 */}
        {agentNode(2, "Accessibility Audit", "#7C3AED", "MULTI-MODEL", <>
          {modelChips}
          {synthBar("WCAG 2.2 AA conformance assessment")}
        </>)}

        {arrow("Agent 1 + 2 findings")}

        {/* Agent 3 */}
        {agentNode(3, "QA / Bug Detection", "#06B6D4", "MULTI-MODEL", <>
          {modelChips}
          {synthBar("3+ agree = confirmed bug \u00b7 1\u20132 = potential")}
        </>)}

        {arrow("Agent 1\u20133 output")}

        {/* Agent 4 */}
        {agentNode(4, "Documentation", "#22C55E", "3 PARALLEL", <>
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            {[
              { label: "Guides", name: "Gemini 3.1 Pro" },
              { label: "HECVAT", name: "GLM-5" },
              { label: "Compliance", name: "Claude Opus 4.6" },
            ].map((m, i) => (
              <div key={i} style={{ flex: 1, padding: "5px 2px", borderRadius: 6, background: C.surface,
                border: `1px solid ${C.border}`, textAlign: "center" }}>
                <div style={{ fontSize: 8, color: C.textDim, fontFamily: "'JetBrains Mono', monospace" }}>{m.label}</div>
                <div style={{ fontSize: 9, color: C.text, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", marginTop: 1 }}>{m.name}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: C.textMid, lineHeight: 1.5 }}>
            User Guide &middot; Admin Guide &middot; Compliance Summary &middot; HECVAT &rarr; .docx/.xlsx
          </div>
        </>)}

        {arrow()}

        {/* Report */}
        <div style={{ ...nodeBase, textAlign: "center", border: `1px solid ${C.accent40}`,
          background: C.accentSoft }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.accent, marginBottom: 8 }}>Final Report &amp; Artifacts</div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
            {["Security Findings", "A11y Audit", "QA / Bugs", "HECVAT XLSX", "User Guide", "Admin Guide", "Compliance"].map(a => (
              <span key={a} style={{ padding: "3px 8px", borderRadius: 4, background: C.successBg,
                border: `1px solid ${C.accent25}`, fontSize: 9, color: C.accent,
                fontFamily: "'JetBrains Mono', monospace" }}>{a}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom note */}
      <div style={{ textAlign: "center", marginTop: 16, fontSize: 10, color: C.textDim, fontFamily: "'JetBrains Mono', monospace" }}>
        All tracks run the same pipeline &middot; Track determines governance, not analysis depth
      </div>
    </div>
  );
}

function AgentCard({ agent }) {
  return (
    <div id={`ap-agent-${agent.num}`} style={{ padding: 28, borderRadius: 12, background: C.surface, border: `1px solid ${C.border}`,
      borderLeft: `4px solid ${agent.color}`, marginBottom: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
          background: `${agent.color}15` }}>
          <agent.Icon size={22} color={agent.color} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
              color: agent.color, background: `${agent.color}12`, padding: "2px 8px", borderRadius: 4 }}>
              AGENT {agent.num}
            </span>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: 0 }}>{agent.name}</h2>
          </div>
          <div style={{ fontSize: 12, color: C.textMid, marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
            {agent.type}
          </div>
        </div>
      </div>

      {/* Description */}
      <p style={{ fontSize: 14, color: C.textMid, lineHeight: 1.65, margin: "0 0 20px" }}>{agent.desc}</p>

      {/* Analysis sections */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, letterSpacing: 0.5, textTransform: "uppercase",
          fontFamily: "'JetBrains Mono', monospace", marginBottom: 10 }}>
          Analysis Sections
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px" }}>
          {agent.sections.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <ChevronRight size={11} color={agent.color} style={{ marginTop: 4, flexShrink: 0 }} aria-hidden="true" />
              <span style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>{s}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tools used */}
      {agent.tools.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, letterSpacing: 0.5, textTransform: "uppercase",
            fontFamily: "'JetBrains Mono', monospace", marginBottom: 10 }}>
            Integrated Tools
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {agent.tools.map((t, i) => (
              <div key={i} style={{ padding: "8px 14px", borderRadius: 8, background: C.bg, border: `1px solid ${C.border}`,
                display: "flex", alignItems: "center", gap: 8 }}>
                <Zap size={12} color={agent.color} aria-hidden="true" />
                <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}><ExtLink href={t.url}>{t.name}</ExtLink></span>
                <span style={{ fontSize: 12, color: C.textMid }}>{t.desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inspirations */}
      {agent.inspirations.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, letterSpacing: 0.5, textTransform: "uppercase",
            fontFamily: "'JetBrains Mono', monospace", marginBottom: 10 }}>
            Inspired By
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {agent.inspirations.map((r, i) => (
              <div key={i} style={{ padding: "8px 14px", borderRadius: 8, background: C.bg, border: `1px solid ${C.border}`,
                display: "inline-flex", alignItems: "center", gap: 8 }}>
                <GitBranch size={12} color={C.textDim} aria-hidden="true" />
                <ExtLink href={r.url}>{r.name}</ExtLink>
                <span style={{ fontSize: 12, color: C.textDim }}>&mdash; {r.desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AgentsPage() {
  const [activeSection, setActiveSection] = useState("overview");
  const { config } = useAuth();
  const scrollingTo = useRef(null);

  const sectionIds = TOC.map(s => s.id);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (scrollingTo.current) return;
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setActiveSection(entry.target.id.replace("ap-", ""));
        }
      }
    }, { rootMargin: "-20% 0px -70% 0px" });
    sectionIds.forEach(id => {
      const el = document.getElementById(`ap-${id}`);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  function scrollTo(id) {
    setActiveSection(id);
    scrollingTo.current = id;
    document.getElementById(`ap-${id}`)?.scrollIntoView({ behavior: "smooth" });
    setTimeout(() => { scrollingTo.current = null; }, 800);
  }

  return (
    <div className="agents-page-layout" style={{ display: "flex", gap: 32 }}>
      {/* Sidebar nav */}
      <div className="agents-page-sidebar">
        <nav aria-label="Page sections" style={{ position: "sticky", top: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, letterSpacing: 0.5, textTransform: "uppercase",
            marginBottom: 12, fontFamily: "'JetBrains Mono', monospace" }}>
            On This Page
          </div>
          {TOC.map(s => (
            <a key={s.id} href={`#ap-${s.id}`}
              onClick={e => { e.preventDefault(); scrollTo(s.id); }}
              style={{ display: "block", padding: "6px 12px", marginBottom: 2, borderRadius: 6, fontSize: 12, fontWeight: 500,
                color: activeSection === s.id ? C.accent : C.textMid,
                background: activeSection === s.id ? C.accentSoft : "transparent",
                textDecoration: "none", cursor: "pointer",
                borderLeft: `2px solid ${activeSection === s.id ? C.accent : "transparent"}`,
                transition: "all .15s" }}>
              {s.label}
            </a>
          ))}
          <div style={{ marginTop: 20, padding: "10px 12px", borderRadius: 8, background: C.surface, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, color: C.textDim, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>PIPELINE</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginTop: 2 }}>4 Agents</div>
            <div style={{ fontSize: 11, color: C.textMid, marginTop: 4 }}>5 models per multi-model agent</div>
            <div style={{ fontSize: 11, color: C.textMid }}>Claude synthesis + dispute resolution</div>
          </div>
        </nav>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Header */}
        <div id="ap-overview" style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: C.text, margin: "0 0 6px", letterSpacing: -0.5 }}>Agent Pipeline</h1>
          <p style={{ fontSize: 15, color: C.textMid, margin: "0 0 4px" }}>
            Four AI agents review every codebase submission with multi-model convergence.
          </p>
          <p style={{ fontSize: 12, color: C.textDim, margin: 0 }}>{config.institutionName} &middot; Enterprise IT &middot; 2026</p>
        </div>

        {/* Pipeline architecture diagram */}
        <PipelineDiagram onScrollTo={scrollTo} />

        {/* Multi-model explainer */}
        <div id="ap-convergence" style={{ padding: 20, borderRadius: 10, background: C.surfaceAlt, border: `1px solid ${C.border}`, marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <Layers size={16} color={C.accent} aria-hidden="true" />
            <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Multi-Model Convergence</span>
          </div>
          <p style={{ fontSize: 13, color: C.textMid, lineHeight: 1.65, margin: "0 0 12px" }}>
            Agents 1, 2, and 3 use a convergence-based approach: five different AI models receive the <strong>same prompt</strong> and
            independently analyze the entire codebase. A finding is <strong>confirmed</strong> if 3+ models flag it,
            <strong> potential</strong> if 1-2 models flag it, and <strong>clean</strong> if zero models flag it. Claude synthesizes
            the results and can re-read source files to resolve disputes between models.
          </p>
          <p style={{ fontSize: 13, color: C.textMid, lineHeight: 1.65, margin: 0 }}>
            All tracks run the same 5-model pipeline. Track determines governance requirements, not analysis depth.
            No model reviews its own work. Claude only synthesizes &mdash; it never runs a pass.
          </p>
        </div>

        {/* Agent Cards — Agent 1 first, then stack dive, then rest */}
        <AgentCard agent={AGENT_DETAILS[0]} />

        {/* Stack-Specific Deep Dive explainer (Agent 1 sub-phase) */}
        <div id="ap-stack-dive" style={{ padding: 20, borderRadius: 10, background: C.surfaceAlt, border: `1px solid ${C.border}`,
          borderLeft: `4px solid #D35C1A`, marginBottom: 20, marginLeft: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <Shield size={16} color="#D35C1A" aria-hidden="true" />
            <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Stack-Specific Deep Dive</span>
          </div>
          <p style={{ fontSize: 13, color: C.textMid, lineHeight: 1.65, margin: "0 0 12px" }}>
            After the 5-model synthesis completes, Agent 1 runs a <strong>second Claude pass</strong> with security checklists
            tailored to the specific frameworks detected in the codebase. The synthesis phase identifies the tech stack
            (e.g., React + Express + PostgreSQL), and the deep dive pass receives only the relevant checklists &mdash;
            not a generic prompt, but targeted questions like &ldquo;does the Express error handler leak stack traces in production?&rdquo;
            or &ldquo;are Ash policy checks applied to sensitive resources?&rdquo;
          </p>
          <p style={{ fontSize: 13, color: C.textMid, lineHeight: 1.65, margin: "0 0 16px" }}>
            Claude reads the actual source code to answer each checklist item. New findings are tagged <code style={{
              fontSize: 11, padding: "1px 5px", borderRadius: 3, background: C.surface, border: `1px solid ${C.border}`,
              fontFamily: "'JetBrains Mono', monospace" }}>stack_specific</code> and
            merged into the main findings &mdash; duplicates of existing convergence findings are excluded.
            If the deep dive fails, the pipeline continues with the original synthesis (it&rsquo;s additive, not blocking).
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { name: "React / Vue / Angular", detail: "XSS, stale closures, client-side secrets, CSP" },
              { name: "Express / Fastify / Koa", detail: "middleware ordering, CORS, shell injection, Helmet" },
              { name: "Spring Boot", detail: "actuator endpoints, CSRF, deserialization, filter chain" },
              { name: "Django / Flask / FastAPI", detail: "DEBUG mode, template injection, subprocess, pickle" },
              { name: "Phoenix / LiveView / Ash", detail: "handle_event auth, Ash policies, PubSub topics, Oban jobs" },
              { name: "PostgreSQL", detail: "SQL injection, RLS, connection pooling, superuser access" },
              { name: "MongoDB", detail: "NoSQL injection, ObjectId enumeration, field encryption" },
              { name: "AI / ML", detail: "prompt injection, API key exposure, PII in prompts, token limits" },
              { name: "Docker / K8s", detail: "root user, base image tags, secrets in build, .dockerignore" },
            ].map((c, i) => (
              <div key={i} style={{ padding: "8px 12px", borderRadius: 8, background: C.bg, border: `1px solid ${C.border}`,
                flex: "1 1 calc(33% - 8px)", minWidth: 200 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 2 }}>{c.name}</div>
                <div style={{ fontSize: 11, color: C.textDim }}>{c.detail}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Remaining agent cards (2, 3, 4) */}
        {AGENT_DETAILS.slice(1).map(agent => (
          <AgentCard key={agent.id} agent={agent} />
        ))}

        {/* Why These Models */}
        <div id="ap-why-models" style={{ marginTop: 40, marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <Brain size={16} color={C.accent} aria-hidden="true" />
            <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Why These Models</span>
          </div>
          <p style={{ fontSize: 13, color: C.textMid, lineHeight: 1.65, marginTop: 0, marginBottom: 8 }}>
            The pipeline deliberately selects models from <strong>different providers, training corpora, and architectures</strong>.
            A single model — no matter how capable — has systematic blind spots shaped by its training data.
            Five independent models trained on different data catch different things. When 3+ independently agree on a finding,
            the signal is far more reliable than any single model&rsquo;s output.
          </p>
          <p style={{ fontSize: 13, color: C.textMid, lineHeight: 1.65, marginTop: 0, marginBottom: 20 }}>
            Selection criteria: <strong>agentic CLI tool</strong> (filesystem access, not API-only),
            <strong> structured JSON output</strong> (parseable findings),
            <strong> provider diversity</strong> (no two models from the same training pipeline),
            and <strong>US-accessible API</strong> (institutional compliance).
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {CLI_TOOLS.map((tool, i) => (
              <div key={i} style={{ padding: "14px 18px", borderRadius: 10, background: C.surface, border: `1px solid ${C.border}`,
                display: "flex", gap: 16, alignItems: "flex-start",
                borderLeft: tool.role === "synthesis" ? `3px solid ${C.accent}` : `3px solid ${C.border}` }}>
                <div style={{ minWidth: 100 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                    <ExtLink href={tool.url}>{tool.name}</ExtLink>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.accent, fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
                    {tool.model}
                  </div>
                  <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>{tool.provider}</div>
                  {tool.role === "synthesis" && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: C.accent, background: C.accentSoft,
                      padding: "1px 6px", borderRadius: 3, marginTop: 4, display: "inline-block",
                      fontFamily: "'JetBrains Mono', monospace" }}>SYNTHESIS ONLY</span>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.55, marginBottom: 4 }}>{tool.rationale}</div>
                  <div style={{ fontSize: 11, color: C.textDim, fontStyle: "italic" }}>{tool.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CLI Tools */}
        <div id="ap-cli-tools" style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <Terminal size={16} color={C.accent} aria-hidden="true" />
            <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>CLI Tools</span>
          </div>
          <p style={{ fontSize: 13, color: C.textMid, lineHeight: 1.65, marginTop: 0, marginBottom: 16 }}>
            The uploaded codebase is extracted into an isolated Docker container. The CLI tools run inside that container
            with full filesystem access to the codebase &mdash; no chunking, no file sampling, every file is reviewable.
            Docker provides <strong>security isolation</strong> (untrusted code never touches the host),
            <strong> reproducible environments</strong> (consistent analysis regardless of codebase),
            and <strong>clean teardown</strong> (container is destroyed after analysis, no artifacts persist).
          </p>
          <div className="responsive-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {[
              { name: "Codex CLI", by: "OpenAI", desc: "Sandboxed execution, autonomous exploration, structured output", url: "https://github.com/openai/codex" },
              { name: "Gemini CLI", by: "Google", desc: "Long-context document generation for Agent 4 (User Guide, Admin Guide)", url: "https://github.com/google-gemini/gemini-cli" },
              { name: "opencode", by: "SST", desc: "Multi-provider CLI supporting OpenRouter backends (MiniMax, MiMo, Kimi, GLM)", url: "https://github.com/nicholasq/opencode" },
              { name: "Claude Code", by: "Anthropic", desc: "Synthesis + Agent 4 Compliance Summary — filesystem access for dispute resolution", url: "https://github.com/anthropics/claude-code" },
            ].map((t, i) => (
              <div key={i} style={{ padding: 14, borderRadius: 10, background: C.surface, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 2 }}>
                  <ExtLink href={t.url}>{t.name}</ExtLink>
                </div>
                <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6 }}>{t.by}</div>
                <div style={{ fontSize: 11, color: C.textMid, lineHeight: 1.5 }}>{t.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Standards & Frameworks */}
        <div id="ap-standards" style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <Users size={16} color={C.accent} aria-hidden="true" />
            <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Standards & Frameworks Referenced</span>
          </div>
          <div className="responsive-grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {FRAMEWORKS.map((fw, i) => (
              <div key={i} style={{ padding: 14, borderRadius: 8, background: C.surface, border: `1px solid ${C.border}`,
                display: "flex", alignItems: "center", gap: 10 }}>
                <Users size={14} color={C.textDim} aria-hidden="true" />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                    <ExtLink href={fw.url}>{fw.name}</ExtLink>
                  </div>
                  <div style={{ fontSize: 11, color: C.textMid }}>{fw.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: 20, borderRadius: 10, background: C.surfaceAlt, border: `1px solid ${C.border}`, textAlign: "center" }}>
          <p style={{ fontSize: 13, color: C.textMid, lineHeight: 1.6, margin: 0, maxWidth: 640, marginLeft: "auto", marginRight: "auto" }}>
            The agent pipeline is open-source infrastructure built at {config.institutionName}.
            It stands on the shoulders of the open-source community &mdash; the tools, frameworks, and projects listed above
            made this possible.
          </p>
          <a href="https://github.com/umzcio/AIF" target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12, padding: "6px 14px",
              borderRadius: 6, background: C.surface, border: `1px solid ${C.border}`, color: C.text,
              fontSize: 12, fontWeight: 600, textDecoration: "none", transition: "background .15s" }}
            onMouseEnter={e => e.currentTarget.style.background = C.surfaceHover}
            onMouseLeave={e => e.currentTarget.style.background = C.surface}>
            <Github size={14} /> View on GitHub
          </a>
          <p style={{ fontSize: 12, color: C.textDim, margin: "10px 0 0" }}>Office of the CIO &middot; Enterprise IT &middot; Last updated March 12, 2026</p>
        </div>
      </div>
    </div>
  );
}
