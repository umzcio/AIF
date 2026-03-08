import { useState } from "react";
import { ChevronRight, AlertTriangle, Github } from "lucide-react";
import { C, TRACK_COLORS, TRACK_LABELS } from "../constants.js";
import { TrackBadge } from "./primitives.jsx";

export default function FrameworkDoc() {
  const [activeSection, setActiveSection] = useState("purpose");

  const sections = [
    { id: "purpose", label: "Purpose & Framing" },
    { id: "quickstart", label: "Quick Start" },
    { id: "lineage", label: "Framework Lineage" },
    { id: "ethics", label: "Ethical Principles" },
    { id: "existing", label: "Existing Tools" },
    { id: "multi-tool", label: "Multi-Tool Pipelines" },
    { id: "weights", label: "Weight Matrix" },
    { id: "escalations", label: "Escalation Conditions" },
    { id: "tiers", label: "Routing Tiers" },
    { id: "post-prod", label: "Post-Production" },
    { id: "not", label: "What This Is Not" },
    { id: "adopting", label: "Adopting This Framework" },
  ];

  const h2Style = { fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 12, marginTop: 0, paddingBottom: 10, borderBottom: `1px solid ${C.border}` };
  const h3Style = { fontSize: 14, fontWeight: 700, color: C.accent, marginBottom: 8, marginTop: 20 };
  const pStyle = { fontSize: 13.5, color: C.textMid, lineHeight: 1.75, marginBottom: 12 };
  const liStyle = { fontSize: 13.5, color: C.textMid, lineHeight: 1.75, marginBottom: 6, paddingLeft: 4 };
  const calloutStyle = { padding: "14px 18px", borderRadius: 8, background: C.accentSoft, border: `1px solid ${C.accent30}`, marginBottom: 16 };
  const tableWrap = { borderRadius: 8, border: `1px solid ${C.border}`, overflow: "hidden", marginBottom: 16 };
  const thStyle = { padding: "10px 14px", background: C.surfaceAlt, fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "'JetBrains Mono', monospace", textAlign: "left", borderBottom: `1px solid ${C.border}` };
  const tdStyle = { padding: "10px 14px", fontSize: 13, color: C.textMid, borderBottom: `1px solid ${C.border}`, verticalAlign: "top", lineHeight: 1.5 };
  const tdBold = { ...tdStyle, color: C.text, fontWeight: 600 };
  const sectionStyle = { marginBottom: 40 };

  return (
    <div style={{ display: "flex", gap: 32 }}>
      {/* Sidebar nav */}
      <div style={{ width: 200, flexShrink: 0 }}>
        <div style={{ position: "sticky", top: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 12, fontFamily: "'JetBrains Mono', monospace" }}>On This Page</div>
          {sections.map(s => (
            <a key={s.id} href={`#fw-${s.id}`} onClick={(e) => { e.preventDefault(); setActiveSection(s.id); document.getElementById(`fw-${s.id}`)?.scrollIntoView({ behavior: "smooth" }); }}
              style={{ display: "block", padding: "6px 12px", marginBottom: 2, borderRadius: 6, fontSize: 12, fontWeight: 500,
                color: activeSection === s.id ? C.accent : C.textMid, background: activeSection === s.id ? C.accentSoft : "transparent",
                textDecoration: "none", cursor: "pointer", borderLeft: `2px solid ${activeSection === s.id ? C.accent : "transparent"}`, transition: "all .15s" }}>
              {s.label}
            </a>
          ))}
          <div style={{ marginTop: 20, padding: "10px 12px", borderRadius: 8, background: C.surface, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, color: C.textDim, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>VERSION</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginTop: 2 }}>v1.0 Draft</div>
            <div style={{ fontSize: 11, color: C.textMid, marginTop: 4 }}>Zachary Rossmiller, CIO</div>
            <div style={{ fontSize: 11, color: C.textMid }}>University of Montana · 2026</div>
          </div>
        </div>
      </div>

      {/* Document content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: C.text, margin: "0 0 6px", letterSpacing: -0.5 }}>AI-Built Tool Code Intake</h1>
          <p style={{ fontSize: 15, color: C.textMid, margin: "0 0 4px" }}>Governance framework and intake specification for AI-assisted code</p>
          <p style={{ fontSize: 12, color: C.textDim, margin: 0 }}>Zachary Rossmiller, CIO, University of Montana · v1.0 Draft · 2026</p>
        </div>

        <div id="fw-purpose" style={sectionStyle}>
          <h2 style={h2Style}>Purpose and Framing</h2>
          <p style={pStyle}>This document is the governance framework and operational specification for the AI-Built Tool Code Intake process. It covers the rationale behind the process, the intake form question by question, the routing logic that determines what review a submission receives, and the tier requirements that govern what happens before a tool goes to production.</p>
          <p style={pStyle}>The purpose of this process is to ensure that custom AI-assisted code meets campus security standards, follows best practice coding principles, and satisfies WCAG 2.1 AA accessibility requirements before reaching production. It is similar in intent to a software requisition process — but for custom-built code rather than purchased software.</p>
        </div>

        <div id="fw-quickstart" style={sectionStyle}>
          <h2 style={h2Style}>Quick Start</h2>
          <p style={pStyle}>If you built a tool with AI assistance and want to share it beyond yourself:</p>
          <div style={{ paddingLeft: 16, borderLeft: `2px solid ${C.accent30}`, marginBottom: 16 }}>
            <p style={liStyle}><span style={{ color: C.text, fontWeight: 600 }}>1.</span> Complete the intake form. Your answers determine your score and routing tier.</p>
            <p style={liStyle}><span style={{ color: C.text, fontWeight: 600 }}>2.</span> Check whether any Escalation Conditions apply. If any do, stop and contact IT regardless of your score.</p>
            <p style={liStyle}><span style={{ color: C.text, fontWeight: 600 }}>3.</span> Find your tier in the Score Summary table and follow the requirements for that tier.</p>
          </div>
          <div style={calloutStyle}>
            <p style={{ ...pStyle, marginBottom: 0, color: C.text }}>That is the whole process. All submitted code goes through the automated review pipeline regardless of track. The track determines what human oversight layer sits on top of the automated review.</p>
          </div>
          <div style={tableWrap}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={thStyle}>Weighted Score</th><th style={thStyle}>Tier</th><th style={thStyle}>What Happens Next</th></tr></thead>
              <tbody>
                <tr><td style={tdBold}>Low</td><td style={tdStyle}><TrackBadge track={1} /></td><td style={tdStyle}>Automated review. Acknowledge findings and register.</td></tr>
                <tr><td style={tdBold}>Medium</td><td style={tdStyle}><TrackBadge track={2} /></td><td style={tdStyle}>Automated review. Complete Self-Assessment and self-certify.</td></tr>
                <tr><td style={tdBold}>High</td><td style={tdStyle}><TrackBadge track={3} /></td><td style={tdStyle}>Automated review. IT reviews findings and issues sign-off.</td></tr>
                <tr><td style={tdBold}>Very High / Escalation</td><td style={tdStyle}><TrackBadge track={4} /></td><td style={tdStyle}>Automated review. Stop. Formal IT project required.</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div id="fw-lineage" style={sectionStyle}>
          <h2 style={h2Style}>Framework Lineage and Basis</h2>
          <p style={pStyle}>This framework synthesizes established patterns from multiple recognized sources, adapted for AI-assisted development in higher education:</p>
          {[
            ["NIST AI RMF 1.0 (2023)", "Risk-tiered routing where scrutiny is proportional to impact rather than applied uniformly."],
            ["ITIL Change Management", "Classification of changes into standard, normal, and emergency tiers based on risk and complexity."],
            ["WitnessAI Agentic Governance", "End-to-end lifecycle governance including agent identity, human-in-the-loop controls, and auditability."],
            ["REI Systems Public Sector Lifecycle", "Phased approach to AI autonomy with escalating risk-based controls and dynamic oversight."],
            ["Agentic Trust Framework (CSA)", "Zero Trust principles applied to AI agents and alignment with OWASP standards."],
            ["KPMG Agentic AI Framework", "Layered security, rollback protocols, and scope constraints on data access and decision authority."],
            ["EDUCAUSE AI Governance (2024)", "Three-part institutional structure of governance, operations, and pedagogy."],
            ["EDUCAUSE AI Ethics (2025)", "Beneficence, Respect for Autonomy, Transparency, and Accountability."],
          ].map(([title, desc], i) => (
            <div key={i} style={{ display: "flex", gap: 12, marginBottom: 10, paddingLeft: 4 }}>
              <ChevronRight size={14} color={C.accent} style={{ marginTop: 3, flexShrink: 0 }} />
              <p style={{ ...pStyle, marginBottom: 0 }}><span style={{ color: C.text, fontWeight: 600 }}>{title}:</span> {desc}</p>
            </div>
          ))}
          <div style={{ padding: "14px 18px", borderRadius: 8, background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.2)", marginTop: 16 }}>
            <p style={{ ...pStyle, marginBottom: 0, color: TRACK_COLORS[3] }}>Only 9% of higher education institutions report that their existing cybersecurity and privacy policies are adequate for AI risks (EDTech Magazine / EDUCAUSE, 2026). This framework is a direct response to that gap.</p>
          </div>
        </div>

        <div id="fw-ethics" style={sectionStyle}>
          <h2 style={h2Style}>Guiding Ethical Principles</h2>
          <p style={pStyle}>This framework adopts the EDUCAUSE AI Ethical Guidelines (2025) as its normative foundation.</p>
          <div style={tableWrap}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={thStyle}>Principle</th><th style={thStyle}>What It Means</th><th style={thStyle}>Where It Applies</th></tr></thead>
              <tbody>
                <tr><td style={tdBold}>Beneficence</td><td style={tdStyle}>The tool must produce genuine benefit for students, staff, or the institution — not just convenience for the builder.</td><td style={tdStyle}>Self-Assessment: intended beneficiaries and outcomes; Track 3: equity check.</td></tr>
                <tr><td style={tdBold}>Respect for Autonomy</td><td style={tdStyle}>People affected must know the tool exists, understand what it does, and retain meaningful agency.</td><td style={tdStyle}>Pedagogy escalation conditions; Track 3 user disclosure assessment.</td></tr>
                <tr><td style={tdBold}>Transparency</td><td style={tdStyle}>Logic, data sources, and outputs must be explainable to a non-technical reviewer. No black-box systems.</td><td style={tdStyle}>Builder Comprehension dimension (0-3); plain-language explanation required.</td></tr>
                <tr><td style={tdBold}>Accountability</td><td style={tdStyle}>A named individual or team must be responsible for behavior, impacts, and maintenance.</td><td style={tdStyle}>Ownership transfer (all tiers); version sign-off; 30-day grace on lapse.</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div id="fw-existing" style={sectionStyle}>
          <h2 style={h2Style}>Existing Tools and the Onboarding Path</h2>
          <p style={pStyle}>Institutions should establish a 90-day onboarding window for existing tools to self-register via retrospective triage.</p>
          <div style={{ paddingLeft: 16, borderLeft: `2px solid ${C.accent30}` }}>
            <p style={liStyle}><span style={{ fontWeight: 600, color: C.text }}>Track 1:</span> Registration only.</p>
            <p style={liStyle}><span style={{ fontWeight: 600, color: C.text }}>Track 2:</span> Complete Self-Assessment within 90 days or be suspended.</p>
            <p style={liStyle}><span style={{ fontWeight: 600, color: C.text }}>Track 3/4:</span> Report to IT immediately. Remediation timeline agreed jointly.</p>
            <p style={liStyle}><span style={{ fontWeight: 600, color: C.text }}>No owner:</span> Flagged for review. Suspended if no owner within 30 days.</p>
          </div>
          <div style={{ padding: "14px 18px", borderRadius: 8, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)", marginTop: 12 }}>
            <p style={{ ...pStyle, marginBottom: 0, color: TRACK_COLORS[4], fontSize: 13 }}>Tools discovered after the 90-day window are subject to the standard framework immediately without grace period.</p>
          </div>
        </div>

        <div id="fw-multi-tool" style={sectionStyle}>
          <h2 style={h2Style}>Multi-Tool and Agentic Pipeline Composition</h2>
          <p style={pStyle}>The intake assesses individual tools. Three tools that each score Track 2 may collectively warrant Track 3 or 4 when assessed as a system. This is the defining risk of agentic AI architectures.</p>
          <div style={calloutStyle}>
            <p style={{ ...pStyle, marginBottom: 0, color: C.text, fontWeight: 500 }}>A pipeline exists when two or more tools share data, pass outputs, or coordinate actions creating combined capability. This includes shared databases, API integrations, MCP connections, and regular manual data handoffs.</p>
          </div>
        </div>

        <div id="fw-weights" style={sectionStyle}>
          <h2 style={h2Style}>Dimension Weight Matrix</h2>
          <p style={pStyle}>Each dimension is scored 0-3. The score is multiplied by the weight for the artifact type. Weighted scores sum to determine routing tier.</p>
          <div style={tableWrap}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={thStyle}>Dimension</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Public Site</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Internal App</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Script / API</th>
                <th style={{ ...thStyle, textAlign: "center" }}>AI Agent</th>
              </tr></thead>
              <tbody>
                {[
                  ["Security / Vulnerability", "Critical (×4)", "High (×3)", "High (×3)", "High (×3)"],
                  ["Accessibility (WCAG 2.1 AA)", "Critical (×4)", "High (×3)", "N/A (×0)", "Low (×1)"],
                  ["Data Sensitivity", "High (×3)", "Critical (×4)", "High (×3)", "High (×3)"],
                  ["Blast Radius", "High (×3)", "Medium (×2)", "Medium (×2)", "Critical (×4)"],
                  ["Autonomy", "Low (×1)", "Low (×1)", "Medium (×2)", "Critical (×4)"],
                  ["Builder Comprehension", "Medium (×2)", "Medium (×2)", "Medium (×2)", "Critical (×4)"],
                  ["Maintenance / Supportability", "High (×3)", "High (×3)", "High (×3)", "High (×3)"],
                ].map(([dim, ...vals], i) => (
                  <tr key={i}>
                    <td style={tdBold}>{dim}</td>
                    {vals.map((v, j) => {
                      const isCrit = v.includes("Critical"); const isHigh = v.includes("High"); const isNA = v.includes("N/A");
                      return <td key={j} style={{ ...tdStyle, textAlign: "center", color: isCrit ? TRACK_COLORS[4] : isHigh ? TRACK_COLORS[3] : isNA ? C.textDim : C.textMid, fontWeight: isCrit ? 700 : 500 }}>{v}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div id="fw-escalations" style={sectionStyle}>
          <h2 style={h2Style}>Escalation Conditions</h2>
          <p style={pStyle}>These conditions route to Track 4 regardless of weighted score — categorical risks that scoring alone cannot capture.</p>
          <h3 style={h3Style}>IT Escalation Conditions</h3>
          {["HIPAA, IRB human subjects, export-controlled, or tribal/indigenous data",
            "FERPA-covered data combined with public-facing deployment",
            "Institutional data stored in personal accounts without DPA",
            "Data sent to AI model with no DPA or unknown DPA status",
            "Authentication outside campus SSO without IT-approved alternative",
            "Vendor accessing campus data without approved DPA",
            "No version control at Track 2 or above",
            "Deployed where campus has no visibility into AI model training or updates",
          ].map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 10, marginBottom: 6, paddingLeft: 4 }}>
              <AlertTriangle size={13} color={TRACK_COLORS[4]} style={{ marginTop: 3, flexShrink: 0 }} />
              <p style={{ ...pStyle, marginBottom: 0 }}>{item}</p>
            </div>
          ))}
          <h3 style={h3Style}>Pedagogy and Academic Integrity</h3>
          {["Deployed in a course without faculty awareness",
            "Students unaware of AI interaction or evaluation",
            "Could compromise academic integrity without faculty oversight",
            "Student behavioral/performance data beyond FERPA authorization",
          ].map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 10, marginBottom: 6, paddingLeft: 4 }}>
              <AlertTriangle size={13} color={TRACK_COLORS[3]} style={{ marginTop: 3, flexShrink: 0 }} />
              <p style={{ ...pStyle, marginBottom: 0 }}>{item}</p>
            </div>
          ))}
        </div>

        <div id="fw-tiers" style={sectionStyle}>
          <h2 style={h2Style}>Routing Tiers</h2>
          {[
            { t: 1, title: "Automated review. Register and go.", when: ["Low band score", "No institutional data", "Builder or immediate team only", "No escalations"],
              req: ["Automated pipeline: Code/Security, Accessibility, HECVAT-Lite, Documentation", "Register in IT tool registry", "Record builder, purpose, and owner", "Review and acknowledge findings", "No human sign-off unless material change"] },
            { t: 2, title: "Automated review plus builder self-certification.", when: ["Medium band score", "Internal non-sensitive data", "Team or department use", "No escalations"],
              req: ["Automated pipeline runs", "Complete Self-Assessment (length scales with score)", "Plain-language explanation of tool behavior", "Document data access and storage", "Confirm auth and access controls", "Identify tool successor", "Department head sign-off", "Builder self-certifies"] },
            { t: 3, title: "Automated review plus IT human review.", when: ["High band score", "PII, FERPA, or HR data", "Serves students or public", "Significant blast radius"],
              req: ["Automated pipeline runs", "Full Self-Assessment", "IT human review of findings", "Security architecture review", "Data classification review", "Accessibility review (WCAG 2.1 AA / 508)", "Equity review", "Supportability plan", "IT sign-off before go-live"] },
            { t: 4, title: "Formal IT project and institutional sign-off.", when: ["Very high band score", "Any escalation condition", "Regulated data (HIPAA, export, IRB)", "Autonomous decisions without human review"],
              req: ["Automated pipeline runs", "Stop — contact IT immediately", "Formal IT project request", "IT leadership scoping", "Security, privacy, legal, compliance review", "Architecture approval", "Project plan with testing, rollback, support", "Formal sign-off before go-live"] },
          ].map(tier => (
            <div key={tier.t} style={{ padding: 20, borderRadius: 10, background: C.surface, border: `1px solid ${C.border}`, marginBottom: 16, borderLeft: `3px solid ${TRACK_COLORS[tier.t]}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <TrackBadge track={tier.t} />
                <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{tier.title}</span>
              </div>
              <h4 style={{ fontSize: 11, fontWeight: 700, color: C.textDim, letterSpacing: 0.5, textTransform: "uppercase", margin: "12px 0 6px" }}>Route here when</h4>
              {tier.when.map((w, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 3, paddingLeft: 8 }}>
                  <ChevronRight size={12} color={TRACK_COLORS[tier.t]} style={{ marginTop: 3, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: C.textMid, lineHeight: 1.5 }}>{w}</span>
                </div>
              ))}
              <h4 style={{ fontSize: 11, fontWeight: 700, color: C.textDim, letterSpacing: 0.5, textTransform: "uppercase", margin: "14px 0 6px" }}>Required before proceeding</h4>
              {tier.req.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 3, paddingLeft: 8 }}>
                  <span style={{ fontSize: 12, color: TRACK_COLORS[tier.t], fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", width: 18, flexShrink: 0 }}>{i + 1}.</span>
                  <span style={{ fontSize: 13, color: C.textMid, lineHeight: 1.5 }}>{r}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div id="fw-post-prod" style={sectionStyle}>
          <h2 style={h2Style}>Post-Production Monitoring</h2>
          <p style={pStyle}>Approval is a moment in time. Ongoing monitoring is required for all production tools.</p>
          {["All tools registered with designated owner and approved version.",
            "Track 1: annual self-confirmation nothing material changed.",
            "Track 2: designated owner self-certifies annually.",
            "Track 3: annual re-scan (security, accessibility, code review).",
            "Track 4: annual formal IT review with updated sign-off.",
            "Any material change triggers full re-review from intake.",
            "AI model tools: owner monitors provider changelogs. Provider updates = material change.",
            "Owner departure: 30 days to designate new owner or tool is suspended.",
            "Runtime anomalies reported through standard incident management.",
          ].map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 10, marginBottom: 6, paddingLeft: 4 }}>
              <ChevronRight size={13} color={C.accent} style={{ marginTop: 3, flexShrink: 0 }} />
              <p style={{ ...pStyle, marginBottom: 0 }}>{item}</p>
            </div>
          ))}
        </div>

        <div id="fw-not" style={sectionStyle}>
          <h2 style={h2Style}>What This Framework Is Not</h2>
          <p style={pStyle}>This framework enables AI-assisted development, not restricts it.</p>
          {["Not a substitute for faculty governance. Tools affecting curriculum require faculty senate review in addition to IT sign-off.",
            "Not a replacement for existing data governance, FERPA, or security standards. Existing policy governs where conflicts arise.",
            "Does not address IP, open-source licensing, or institutional ownership. Those follow existing employment policies.",
            "Not final. Thresholds, escalation conditions, and requirements will be refined through stress-testing.",
          ].map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10, paddingLeft: 4 }}>
              <ChevronRight size={13} color={C.textMid} style={{ marginTop: 3, flexShrink: 0 }} />
              <p style={{ ...pStyle, marginBottom: 0 }}>{item}</p>
            </div>
          ))}
        </div>

        <div id="fw-adopting" style={sectionStyle}>
          <h2 style={h2Style}>Adopting This Framework</h2>
          <p style={pStyle}>Designed to be adapted, not just adopted. The structure is portable across higher education institutions. The source code and framework documents are available on{" "}
            <a href="https://github.com/umzcio/AIF" target="_blank" rel="noopener noreferrer"
              style={{ color: C.accent, textDecoration: "none", fontWeight: 600 }}
              onMouseEnter={e => e.currentTarget.style.textDecoration = "underline"}
              onMouseLeave={e => e.currentTarget.style.textDecoration = "none"}>
              <Github size={12} style={{ verticalAlign: "-1px", marginRight: 3 }} />GitHub</a>.
          </p>
          {["Calibrate the weight matrix against your tool landscape. Run intake against 5-10 existing tools.",
            "Map escalation conditions to your enterprise systems and data governance policies.",
            "Build the Self-Assessment reflecting local data governance and AI tool prevalence.",
            "Define tool registry structure: required fields, maintenance responsibility, CMDB integration.",
            "Define material change for your context with institution-specific triggers.",
            "Complete stress test before enforcing tier routing. Do not publish as policy until validated.",
          ].map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10, paddingLeft: 4 }}>
              <span style={{ fontSize: 12, color: C.accent, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", width: 18, flexShrink: 0 }}>{i + 1}.</span>
              <p style={{ ...pStyle, marginBottom: 0 }}>{item}</p>
            </div>
          ))}
        </div>

        <div style={{ padding: 20, borderRadius: 10, background: C.surfaceAlt, border: `1px solid ${C.border}`, marginTop: 32 }}>
          <h3 style={{ ...h3Style, marginTop: 0 }}>Document Preparation Notice</h3>
          <p style={{ ...pStyle, marginBottom: 8 }}>Prepared collaboratively by University of Montana Enterprise IT staff and an AI assistant (Anthropic Claude). Frameworks, decisions, and editorial judgment are those of UM IT leadership.</p>
          <p style={{ ...pStyle, marginBottom: 0, fontStyle: "italic" }}>This is a living draft. It does not constitute legal advice, official policy, or a final governance determination. Direct questions to the Office of the CIO.</p>
          <p style={{ fontSize: 12, color: C.textDim, margin: "12px 0 0" }}>Last updated March 7, 2026</p>
        </div>
      </div>
    </div>
  );
}
