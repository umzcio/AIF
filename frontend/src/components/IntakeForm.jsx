import { useState, useCallback } from "react";
import { Check, AlertTriangle } from "lucide-react";
import { C, TRACK_COLORS, TRACK_LABELS, computeTrack, DIMENSION_SHORT } from "../constants.js";
import { navigate } from "../hooks/useHashRouter.js";
import { submitIntake } from "../api.js";
import { useToast } from "./Toast.jsx";
import { Btn, TrackBadge } from "./primitives.jsx";

function SelectOption({ label, value, selected, onClick }) {
  return (
    <button type="button" onClick={() => onClick(value)} className="data-row" style={{
      display: "block", width: "100%", textAlign: "left", cursor: "pointer",
      borderColor: selected ? C.accent : C.border, background: selected ? C.accentSoft : C.bg,
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, border: `2px solid ${selected ? C.accent : C.border}`,
          background: selected ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {selected && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff" }} />}
        </span>
        <span style={{ fontWeight: 500, fontSize: 13.5 }}>{label}</span>
      </span>
    </button>
  );
}

function CheckOption({ label, value, checked, onChange }) {
  return (
    <button type="button" onClick={() => onChange(value)} className="data-row" style={{
      display: "block", width: "100%", textAlign: "left", cursor: "pointer",
      borderColor: checked ? C.accent : C.border, background: checked ? C.accentSoft : C.bg,
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, border: `2px solid ${checked ? C.accent : C.border}`,
          background: checked ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, color: "#fff", fontWeight: 700 }}>{checked && <Check size={11} strokeWidth={3} />}</span>
        <span style={{ fontWeight: 500, fontSize: 13.5 }}>{label}</span>
      </span>
    </button>
  );
}

function Q({ n, label, req, routing, esc, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <span className="mono" style={{ fontSize: 11, color: C.accent, fontWeight: 600 }}>Q{n}</span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
        {req && <span style={{ fontSize: 9, color: TRACK_COLORS[3], fontWeight: 700, letterSpacing: 0.5 }}>REQUIRED</span>}
      </div>
      {routing && <p style={{ fontSize: 11.5, color: C.textMid, marginBottom: 8, fontStyle: "italic", lineHeight: 1.4, maxWidth: 600, marginTop: 0 }}>{routing}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{children}</div>
      {esc && <div style={{ marginTop: 8, padding: "7px 12px", borderRadius: 6, background: "rgba(239,68,68,0.07)", border: `1px solid rgba(239,68,68,0.18)`,
        display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: TRACK_COLORS[4], fontWeight: 700, fontSize: 14, display: "flex" }}><AlertTriangle size={14} /></span>
        <span style={{ fontSize: 12, color: TRACK_COLORS[4], lineHeight: 1.3 }}>{esc}</span>
      </div>}
    </div>
  );
}

function SectionDivider({ num, title, sub }) {
  return (
    <div style={{ marginBottom: 20, marginTop: 36, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="mono" style={{ width: 26, height: 26, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
          background: C.accentSoft, color: C.accent, fontWeight: 700, fontSize: 12 }}>{num}</span>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{title}</h2>
      </div>
      {sub && <p style={{ margin: "4px 0 0 36px", fontSize: 12, color: C.textMid }}>{sub}</p>}
    </div>
  );
}

export default function IntakeForm({ draftId }) {
  const { toast } = useToast();
  const [a, setA] = useState({});
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const s = useCallback((k, v) => setA(p => ({ ...p, [k]: v })), []);
  const tm = useCallback((k, v) => setA(p => {
    const arr = p[k] || [];
    return { ...p, [k]: arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v] };
  }), []);

  const result = computeTrack(a);
  const showData = a.q9 === "yes";
  const showAI = a.q1 === "ai-agent" || a.q12 === "approved-dpa" || a.q12 === "unknown-dpa" || a.q12 === "no-dpa";

  async function handleSubmit() {
    if (!name.trim()) { toast.error("Tool name is required"); return; }
    setSubmitting(true);
    try {
      const res = await submitIntake({
        name,
        description,
        artifactType: a.q1 || "other",
        intakeAnswers: a,
      });
      toast.success(`"${name}" submitted — Track ${res.track}`);
      navigate(`/upload/${res.tool.id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <header>
        <div className="eyebrow">AI Tool Intake</div>
        <h1 style={{ margin: "6px 0 0", fontSize: 22, letterSpacing: "-0.02em" }}>Submit a new tool for review</h1>
        <p className="body-copy">Answer the questions below. Your responses determine the review track.</p>
      </header>

      <div style={{ display: "flex", gap: 24 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Tool basics */}
          <SectionDivider num="0" title="Tool Identity" sub="Name and describe your tool." />
          <div style={{ marginBottom: 24 }}>
            <div className="field" style={{ marginBottom: 14 }}>
              <label htmlFor="tool-name">Tool name</label>
              <input id="tool-name" className="text-field" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Advising assistant" />
            </div>
            <div className="field">
              <label htmlFor="tool-desc">Description</label>
              <textarea id="tool-desc" className="text-area" value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this tool do?" style={{ minHeight: 80 }} />
            </div>
          </div>

          <SectionDivider num="1" title="What Did You Build?" sub="Classifies artifact type and sets dimension weight profile." />
          <Q n={1} label="What best describes what you built?" req>
            {[["public-site","Public-facing website or web app"],["internal-app","Internal web app (requires auth)"],["script-api","Script, automation, or API integration"],
              ["ai-agent","AI-powered tool or agent"],["data-pipeline","Data pipeline or reporting tool"],["other","Something else"]
            ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q1===v} onClick={x=>s("q1",x)} />)}
          </Q>
          <Q n={2} label="Is this tool already in production?" req>
            {[["no","No — new and not in use"],["yes","Yes — already being used"],["partial","Partially — using but not shared"]
            ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q2===v} onClick={x=>s("q2",x)} />)}
          </Q>
          <Q n={3} label="Who will use this tool?" req routing="Informs Blast Radius. Student/public use activates elevated review.">
            {[["just-me","Just me"],["team","My immediate team (<10)"],["department","A department or unit"],["students","Students"],["public","The general public"],["external","External partners"]
            ].map(([v,l]) => <CheckOption key={v} value={v} label={l} checked={(a.q3||[]).includes(v)} onChange={x=>tm("q3",x)} />)}
          </Q>
          <Q n={4} label="Describe what this tool does and what problem it solves." req>
            <textarea className="text-area" value={a.q4 || ""} onChange={e=>s("q4",e.target.value)} placeholder="3-5 sentences..." style={{ minHeight: 80 }} />
          </Q>

          <SectionDivider num="2" title="Deployment and Access" sub="How and where the tool will run." />
          <Q n={5} label="Where will this tool be accessible?" req
            esc={a.q5==="public-noauth" && showData && (a.q10||[]).some(d=>d!=="public") ? "Public-facing + non-public data = Track 4" : null}>
            {[["public-noauth","Public internet — no auth"],["public-auth","Public internet — requires auth"],["campus-vpn","Campus network / VPN only"],["internal-server","Internal server — no UI"],["undetermined","Not yet determined"]
            ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q5===v} onClick={x=>s("q5",x)} />)}
          </Q>
          <Q n={6} label="Does this tool use campus SSO?" req esc={a.q6==="custom-auth"?"Auth outside campus SSO — escalation":null}>
            {[["sso","Yes — campus SSO"],["no-auth","No auth required"],["custom-auth","Custom or third-party auth"],["not-implemented","Not yet implemented"]
            ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q6===v} onClick={x=>s("q6",x)} />)}
          </Q>
          <Q n={7} label="What infrastructure does this tool require?" req>
            {[["web-hosting","Web hosting"],["server-runtime","Server-side runtime"],["database","Database"],["cron","Scheduled jobs"],["api-endpoints","API endpoints"],
              ["file-storage","File storage"],["email","Email / notifications"],["third-party","Third-party services"],["unknown","Unknown — need help"]
            ].map(([v,l]) => <CheckOption key={v} value={v} label={l} checked={(a.q7||[]).includes(v)} onChange={x=>tm("q7",x)} />)}
          </Q>
          <Q n={8} label="Expected number of users?">
            {[["<50","Fewer than 50"],["50-500","50-500"],["500+","500+ or high-frequency"],["unknown","Unknown"]
            ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q8===v} onClick={x=>s("q8",x)} />)}
          </Q>

          <SectionDivider num="3" title="Data" sub="What data the tool handles, where it lives." />
          <Q n={9} label="Does this tool collect, store, access, process, or transmit any data?" req>
            {[["no","No — generates outputs only"],["yes","Yes — handles data"]
            ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q9===v} onClick={x=>s("q9",x)} />)}
          </Q>
          {showData && <>
            <Q n={10} label="What kind of data?" req esc={(a.q10||[]).some(d=>["hipaa","irb","export","tribal"].includes(d))?"Regulated data = Track 4":null}>
              {[["public","Public / non-sensitive"],["internal","Internal institutional"],["ferpa","FERPA student records"],["hr","Employee / HR"],["hipaa","HIPAA health data"],
                ["irb","IRB research / human subjects"],["export","Export-controlled / CUI"],["tribal","Tribal / indigenous community"],["payment","Payment / financial"],
                ["credentials","Auth credentials / identity"],["behavioral","Behavioral / performance data"]
              ].map(([v,l]) => <CheckOption key={v} value={v} label={l} checked={(a.q10||[]).includes(v)} onChange={x=>tm("q10",x)} />)}
            </Q>
            <Q n={11} label="Where does the data live?" req esc={(a.q11||[]).includes("personal")?"Personal accounts = Track 4":null}>
              {[["campus","Campus IT infrastructure"],["approved-third","Third-party with DPA"],["unknown-third","Third-party — DPA unknown"],["personal","Personal accounts"],["ephemeral","Process and discard"]
              ].map(([v,l]) => <CheckOption key={v} value={v} label={l} checked={(a.q11||[]).includes(v)} onChange={x=>tm("q11",x)} />)}
            </Q>
            <Q n={12} label="Does data leave campus for AI processing?" req esc={(a.q12==="no-dpa"||a.q12==="unknown-dpa")?"No DPA = Track 4":null}>
              {[["no","No external AI"],["approved-dpa","Yes — approved DPA"],["unknown-dpa","Yes — DPA unknown"],["no-dpa","Yes — no DPA"]
              ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q12===v} onClick={x=>s("q12",x)} />)}
            </Q>
            <Q n={13} label="AI model provider and model?" routing="Used to assess model drift risk.">
              <textarea className="text-area" value={a.q13 || ""} onChange={e=>s("q13",e.target.value)} placeholder="e.g., Anthropic Claude Sonnet via API..." style={{ minHeight: 60 }} />
            </Q>
          </>}

          <SectionDivider num="4" title="Maintenance & Ownership" sub="Who owns it, what happens when you leave." />
          <Q n={14} label="Who owns this tool?" req>
            {[["me","I built it and own it"],["department","Built for a department"],["vendor","Vendor / contractor built"],["unclear","Ownership unclear"]
            ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q14===v} onClick={x=>s("q14",x)} />)}
          </Q>
          <Q n={15} label="Is the code in version control?" req esc={a.q15==="no-vc"?"No version control — blocks approval at Track 2+":null}>
            {[["campus-repo","Campus code repository"],["personal-repo","Personal GitHub/GitLab"],["dept-repo","Department repo"],["no-vc","No version control"]
            ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q15===v} onClick={x=>s("q15",x)} />)}
          </Q>
          <Q n={16} label="If you left UM tomorrow, what happens to this tool?" req>
            {[["successor","Designated successor exists"],["documented","Documented for handoff"],["nobody","Nobody else knows how it works"],["stop","Would stop being maintained"]
            ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q16===v} onClick={x=>s("q16",x)} />)}
          </Q>
          <Q n={17} label="Expected maintenance model?" req>
            {[["set-forget","Set and forget"],["occasional","Occasional updates"],["active","Active development"],["third-party-dep","Dependent on third-party"]
            ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q17===v} onClick={x=>s("q17",x)} />)}
          </Q>
          <Q n={18} label="If this tool breaks, who fixes it?" req>
            {[["me-available","Me — available to respond"],["team-runbooks","Team with documented processes"],["only-me","Me — only one who knows"],["unknown","Unknown"]
            ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q18===v} onClick={x=>s("q18",x)} />)}
          </Q>

          {showAI && <>
            <SectionDivider num="5" title="AI-Specific Questions" sub="Your tool uses AI or sends data to an external AI model." />
            <Q n={19} label="Explain in plain language what the tool does and what happens when it fails." req routing="Builder Comprehension check.">
              <textarea className="text-area" value={a.q19 || ""} onChange={e=>s("q19",e.target.value)} placeholder="Walk a non-technical reviewer through the tool..." style={{ minHeight: 100 }} />
            </Q>
            <Q n={20} label="What decisions does this tool make or influence? Human reviewer at decision point?" req>
              <textarea className="text-area" value={a.q20 || ""} onChange={e=>s("q20",e.target.value)} placeholder="Describe decisions and human oversight..." style={{ minHeight: 80 }} />
            </Q>
            <Q n={21} label="Will users know they're interacting with AI?" req esc={a.q21==="no"?"Users unaware of AI — pedagogy escalation":null}>
              {[["yes","Yes — clearly disclosed"],["no","No — users won't know"],["partial","Partially"],["na","N/A — no direct interaction"]
              ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q21===v} onClick={x=>s("q21",x)} />)}
            </Q>
          </>}

          <div style={{ marginTop: 36, paddingTop: 20, borderTop: `1px solid ${C.border}` }}>
            <Btn onClick={handleSubmit} disabled={submitting || !name.trim()}>
              {submitting ? "Submitting..." : "Submit Intake & Upload Code"}
            </Btn>
          </div>
        </div>

        {/* Live scoring sidebar */}
        <div style={{ width: 210, flexShrink: 0 }}>
          <div className="sticky-column">
            <div style={{ padding: 14, borderRadius: 10, background: C.surface, border: `1px solid ${C.border}` }}>
              <div className="section-label" style={{ marginBottom: 10 }}>Live Routing</div>
              <TrackBadge track={result.track} />
              <div className="mono" style={{ marginTop: 10, fontSize: 11, color: C.textMid }}>
                Score: {result.total} / {result.max}
              </div>
              <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: C.border, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${result.pct * 100}%`, borderRadius: 2, background: TRACK_COLORS[result.track], transition: "all .3s" }} />
              </div>
              {result.escalations.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {result.escalations.map((e, i) => (
                    <div key={i} style={{ fontSize: 10, color: TRACK_COLORS[4], marginBottom: 3, display: "flex", alignItems: "center", gap: 4 }}>
                      <AlertTriangle size={10} /> {e}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                {Object.entries(DIMENSION_SHORT).map(([k, l]) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                    <span className="mono" style={{ width: 36, fontSize: 9, color: C.textDim, fontWeight: 600 }}>{l}</span>
                    <div style={{ flex: 1, height: 3, borderRadius: 2, background: C.border, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${(result.dims[k]/3)*100}%`, borderRadius: 2,
                        background: result.weights[k] >= 4 ? TRACK_COLORS[4] : result.weights[k] >= 3 ? TRACK_COLORS[3] : C.accent,
                        transition: "width .3s" }} />
                    </div>
                    <span className="mono" style={{ fontSize: 9, color: C.textDim, width: 22, textAlign: "right" }}>{result.dims[k]}x{result.weights[k]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
