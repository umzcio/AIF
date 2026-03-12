import { Shield, PenLine, Upload, Cpu, LayoutGrid, ChevronRight, ArrowRight, BookOpen } from "lucide-react";
import { C, TRACK_COLORS, TRACK_LABELS } from "../constants.js";
import { useAuth } from "../hooks/useAuth.jsx";
import { navigate } from "../hooks/useHashRouter.js";
import { TrackBadge } from "./primitives.jsx";

export default function Welcome() {
  const { config } = useAuth();
  const stepBoxStyle = { padding: 20, borderRadius: 10, background: C.surface, border: `1px solid ${C.border}`, flex: 1, minWidth: 0 };
  const stepNumStyle = { width: 28, height: 28, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
    fontWeight: 700, fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: "#fff", flexShrink: 0 };
  const arrowStyle = { display: "flex", alignItems: "center", color: C.textDim, flexShrink: 0 };

  return (
    <div>
      {/* Hero */}
      <div style={{ textAlign: "center", padding: "48px 0 40px" }}>
        <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 64, height: 64, borderRadius: 16, marginBottom: 20,
          background: `linear-gradient(135deg, ${C.accent20}, ${C.gold20})`, border: `1px solid ${C.accent30}` }}>
          <Shield size={28} color={C.accent} aria-hidden="true" />
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: C.text, margin: "0 0 10px", letterSpacing: -0.5 }}>
          AI-Built Tool Code Intake
        </h1>
        <p style={{ fontSize: 16, color: C.textMid, margin: "0 auto", maxWidth: 560, lineHeight: 1.65 }}>
          The governance framework for getting AI-assisted code into production at{" "}
          {config.institutionName}. If you built something with AI and want to share
          it beyond yourself, this is where you start.
        </p>
      </div>

      {/* Process Flow */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, letterSpacing: 0.5, textTransform: "uppercase",
          fontFamily: "'JetBrains Mono', monospace", marginBottom: 16, textAlign: "center" }}>
          How It Works
        </div>
        <div className="responsive-flex-process" style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
          {[
            { num: "1", color: C.accent, Icon: PenLine, title: "Intake Form",
              desc: "Answer 21 questions about your tool — what it does, who uses it, what data it touches, and how it's maintained. Your answers are scored automatically." },
            { num: "2", color: "#8B5CF6", Icon: Upload, title: "Upload Code",
              desc: "Submit your codebase as a .zip file. This triggers the automated review pipeline — no manual handoff needed." },
            { num: "3", color: C.gold, Icon: Cpu, title: "Agent Review",
              desc: "Four AI agents review your code: Code/Security, Accessibility (WCAG 2.2 AA), QA / Bug Detection, and Documentation (with HECVAT). You get a findings report." },
            { num: "4", color: TRACK_COLORS[1], Icon: LayoutGrid, title: "Registry",
              desc: "Your tool is registered with a track assignment. Track 1-2 can self-certify. Track 3-4 require IT review before production." },
          ].map((step, i) => (
            <div key={i} style={{ display: "contents" }}>
              <div style={stepBoxStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div style={{ ...stepNumStyle, background: step.color }}>{step.num}</div>
                  <step.Icon size={16} color={step.color} aria-hidden="true" />
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{step.title}</span>
                </div>
                <p style={{ fontSize: 13, color: C.textMid, lineHeight: 1.6, margin: 0 }}>{step.desc}</p>
              </div>
              {i < 3 && <div className="process-arrow" style={arrowStyle}><ChevronRight size={18} aria-hidden="true" /></div>}
            </div>
          ))}
        </div>
      </div>

      {/* Track Overview */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, letterSpacing: 0.5, textTransform: "uppercase",
          fontFamily: "'JetBrains Mono', monospace", marginBottom: 16, textAlign: "center" }}>
          Risk-Tiered Routing
        </div>
        <div className="responsive-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {[
            { t: 1, title: "Register & Go", desc: "Low risk. Automated review only. Acknowledge findings and you're done.",
              items: ["Builder or small team use", "No institutional data", "No escalation conditions"] },
            { t: 2, title: "Self-Certify", desc: "Medium risk. Complete a Self-Assessment and get department head sign-off.",
              items: ["Team or department use", "Internal non-sensitive data", "Builder self-certifies findings"] },
            { t: 3, title: "IT Review", desc: "High risk. IT human review of all findings, architecture, and data handling.",
              items: ["Student or public-facing", "PII, FERPA, or HR data", "IT sign-off required"] },
            { t: 4, title: "Formal Project", desc: "Very high risk or escalation. Full IT project with institutional sign-off.",
              items: ["Regulated data (HIPAA, IRB)", "Any escalation condition", "Formal project plan required"] },
          ].map(tier => (
            <div key={tier.t} style={{ padding: 18, borderRadius: 10, background: C.surface, border: `1px solid ${C.border}`,
              borderTop: `3px solid ${TRACK_COLORS[tier.t]}` }}>
              <div style={{ marginBottom: 10 }}><TrackBadge track={tier.t} /></div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 6 }}>{tier.title}</div>
              <p style={{ fontSize: 12, color: C.textMid, lineHeight: 1.55, marginBottom: 12, marginTop: 0 }}>{tier.desc}</p>
              {tier.items.map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                  <ChevronRight size={11} color={TRACK_COLORS[tier.t]} style={{ marginTop: 3, flexShrink: 0 }} aria-hidden="true" />
                  <span style={{ fontSize: 12, color: C.textMid, lineHeight: 1.45 }}>{item}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* CTAs */}
      <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 48 }}>
        <button onClick={() => navigate("/intake")}
          style={{ padding: "14px 32px", borderRadius: 10, border: "none", cursor: "pointer",
            background: `linear-gradient(135deg, ${C.accent}, ${C.accentHover})`, color: "#fff", fontSize: 15, fontWeight: 700,
            fontFamily: "'DM Sans', sans-serif", boxShadow: `0 4px 24px ${C.accent35}`,
            display: "flex", alignItems: "center", gap: 8, transition: "transform .15s" }}
          onMouseEnter={e => e.currentTarget.style.transform = "translateY(-1px)"}
          onMouseLeave={e => e.currentTarget.style.transform = "translateY(0)"}
          onFocus={e => e.currentTarget.style.transform = "translateY(-1px)"}
          onBlur={e => e.currentTarget.style.transform = "translateY(0)"}>
          Start Intake <ArrowRight size={16} aria-hidden="true" />
        </button>
        <button onClick={() => navigate("/registry")}
          style={{ padding: "14px 24px", borderRadius: 10, border: `1.5px solid ${C.border}`, cursor: "pointer",
            background: "transparent", color: C.textMid, fontSize: 14, fontWeight: 600,
            fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", gap: 6, transition: "all .15s" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.text; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMid; }}
          onFocus={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.text; }}
          onBlur={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMid; }}>
          <LayoutGrid size={14} aria-hidden="true" /> View Registry
        </button>
        <button onClick={() => navigate("/framework")}
          style={{ padding: "14px 24px", borderRadius: 10, border: `1.5px solid ${C.border}`, cursor: "pointer",
            background: "transparent", color: C.textMid, fontSize: 14, fontWeight: 600,
            fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", gap: 6, transition: "all .15s" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.text; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMid; }}
          onFocus={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.text; }}
          onBlur={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMid; }}>
          <BookOpen size={14} aria-hidden="true" /> Read the Framework
        </button>
      </div>

      {/* Foundation callout */}
      <div style={{ padding: 20, borderRadius: 10, background: C.surfaceAlt, border: `1px solid ${C.border}`, textAlign: "center" }}>
        <p style={{ fontSize: 13, color: C.textMid, lineHeight: 1.6, margin: 0, maxWidth: 640, marginLeft: "auto", marginRight: "auto" }}>
          Built on NIST AI RMF, ITIL Change Management, EDUCAUSE AI Ethics, and six additional
          governance frameworks. Designed to enable AI-assisted development at{" "}
          {config.institutionName} — not restrict it.
        </p>
        <p style={{ fontSize: 12, color: C.textDim, margin: "8px 0 0" }}>v1.5 Draft · Office of the CIO · 2026</p>
      </div>
    </div>
  );
}
