import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Check, AlertTriangle, Save, Clock, CheckCircle, Loader } from "lucide-react";
import { C, TRACK_COLORS, TRACK_LABELS, computeTrack, DIMENSION_SHORT } from "../constants.js";
import { navigate } from "../hooks/useHashRouter.js";
import { submitIntake, saveDraft, updateDraft, getTool } from "../api.js";
import { useToast } from "./Toast.jsx";
import { Btn, TrackBadge } from "./primitives.jsx";

const LS_KEY = "aif-intake-autosave";
const AUTOSAVE_LOCAL_MS = 5000;    // localStorage debounce: 5s
const AUTOSAVE_SERVER_MS = 60000;  // Server auto-save: 60s

// All 21 question keys (for progress counting)
const REQUIRED_QUESTIONS = ["q1","q2","q3","q4","q5","q6","q7","q9","q14","q15","q16","q17","q18"];
const ALL_QUESTIONS = ["q1","q2","q3","q4","q5","q6","q7","q8","q9","q10","q11","q12","q13","q14","q15","q16","q17","q18","q19","q20","q21"];

// Field-level validation messages
const FIELD_HINTS = {
  q1: "Select the artifact type that best matches your tool.",
  q2: "Is this tool already in use or brand new?",
  q3: "Select all user groups. This determines blast radius.",
  q4: "3-5 sentences describing the tool and the problem it solves.",
  q5: "Where will people access this tool?",
  q6: "Authentication method — campus SSO is strongly preferred.",
  q7: "Select all infrastructure components needed.",
  q9: "Does the tool handle any data at all?",
  q10: "Select all data types. Regulated data triggers escalation.",
  q11: "Where is data stored? Personal accounts trigger escalation.",
  q12: "Does data leave campus for AI processing?",
  q14: "Who owns and is responsible for this tool?",
  q15: "Version control is required for Track 2+.",
  q16: "Succession planning — what happens if you leave?",
  q17: "How actively will this tool be maintained?",
  q18: "Who responds when the tool breaks?",
  q19: "Explain in plain language what the tool does and failure modes.",
  q20: "What decisions does this tool influence? Is there human oversight?",
  q21: "Will users know they're interacting with AI?",
};

function isAnswered(a, key) {
  const val = a[key];
  if (val === undefined || val === null || val === "") return false;
  if (Array.isArray(val)) return val.length > 0;
  return true;
}

function SelectOption({ label, value, selected, onClick }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={() => onClick(value)} className="data-row" style={{
      display: "block", width: "100%", textAlign: "left", cursor: "pointer",
      borderColor: selected ? C.accent : C.border, background: selected ? C.accentSoft : C.bg,
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, border: `2px solid ${selected ? C.accent : C.border}`,
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
    <button type="button" role="checkbox" aria-checked={checked} onClick={() => onChange(value)} className="data-row" style={{
      display: "block", width: "100%", textAlign: "left", cursor: "pointer",
      borderColor: checked ? C.accent : C.border, background: checked ? C.accentSoft : C.bg,
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, border: `2px solid ${checked ? C.accent : C.border}`,
          background: checked ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, color: "#fff", fontWeight: 700 }}>{checked && <Check size={11} strokeWidth={3} />}</span>
        <span style={{ fontWeight: 500, fontSize: 13.5 }}>{label}</span>
      </span>
    </button>
  );
}

function Q({ n, label, req, routing, esc, hint, answered, children, multi, error }) {
  const qId = `q${n}-label`;
  const errId = `q${n}-error`;
  return (
    <div style={{ marginBottom: 24 }}>
      <div id={qId} tabIndex={-1} style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <span className="mono" style={{ fontSize: 11, color: answered ? C.success : C.accent, fontWeight: 600 }}>Q{n}</span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
        {req && !answered && <span style={{ fontSize: 9, color: TRACK_COLORS[3], fontWeight: 700, letterSpacing: 0.5 }}>REQUIRED</span>}
        {req && answered && <CheckCircle size={12} color={C.success} style={{ flexShrink: 0 }} />}
      </div>
      {routing && <p style={{ fontSize: 11.5, color: C.textMid, marginBottom: 8, fontStyle: "italic", lineHeight: 1.4, maxWidth: 600, marginTop: 0 }}>{routing}</p>}
      {hint && !answered && <p style={{ fontSize: 11.5, color: C.textDim, marginBottom: 6, lineHeight: 1.3, marginTop: 0 }}>{hint}</p>}
      <div role={multi ? "group" : "radiogroup"} aria-labelledby={qId} aria-invalid={!!error || undefined}
        aria-describedby={error ? errId : undefined}
        style={{ display: "flex", flexDirection: "column", gap: 4 }}>{children}</div>
      {error && <div id={errId} role="alert" style={{ fontSize: 12, color: TRACK_COLORS[4], marginTop: 4, fontWeight: 500 }}>{error}</div>}
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

function SaveIndicator({ status, lastSaved }) {
  const label = status === "saving" ? "Saving..."
    : status === "saved" ? `Saved ${lastSaved ? formatTime(lastSaved) : ""}`
    : status === "unsaved" ? "Unsaved changes"
    : null;

  if (!label) return null;

  const color = status === "saved" ? C.success : status === "saving" ? C.accent : C.warning;
  const Icon = status === "saving" ? Loader : status === "saved" ? CheckCircle : Clock;

  return (
    <div role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color, fontWeight: 500, marginTop: 8 }}>
      <Icon size={12} className={status === "saving" ? "pulse" : ""} /> {label}
    </div>
  );
}

function formatTime(date) {
  const d = new Date(date);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m} ${ampm}`;
}

export default function IntakeForm({ draftId }) {
  const { toast } = useToast();
  const [a, setA] = useState({});
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverDraftId, setServerDraftId] = useState(draftId || null);
  const [saveStatus, setSaveStatus] = useState(null); // null | "unsaved" | "saving" | "saved"
  const [lastSaved, setLastSaved] = useState(null);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryData, setRecoveryData] = useState(null);
  const [loadingDraft, setLoadingDraft] = useState(!!draftId);
  const [fieldErrors, setFieldErrors] = useState({});

  const changeCountRef = useRef(0);
  const localSaveTimerRef = useRef(null);
  const serverSaveTimerRef = useRef(null);
  const lastServerSaveRef = useRef(0);

  // Load existing draft from server
  useEffect(() => {
    if (!draftId) { setLoadingDraft(false); return; }
    getTool(draftId).then(data => {
      const tool = data.tool;
      setName(tool.name || "");
      setDescription(tool.description || "");
      if (tool.intake_answers) {
        setA(typeof tool.intake_answers === "string" ? JSON.parse(tool.intake_answers) : tool.intake_answers);
      }
      setServerDraftId(tool.id);
      setSaveStatus("saved");
      setLastSaved(new Date(tool.updated_at));
    }).catch(() => {
      toast.error("Failed to load draft");
    }).finally(() => setLoadingDraft(false));
  }, [draftId]);

  // Check for localStorage recovery on mount (only for new forms, not draft edits)
  useEffect(() => {
    if (draftId) return;
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.timestamp && Date.now() - parsed.timestamp < 7 * 24 * 60 * 60 * 1000) { // within 7 days
          setRecoveryData(parsed);
          setShowRecovery(true);
        } else {
          localStorage.removeItem(LS_KEY);
        }
      }
    } catch { localStorage.removeItem(LS_KEY); }
  }, [draftId]);

  function recoverFromLocal() {
    if (recoveryData) {
      setA(recoveryData.answers || {});
      setName(recoveryData.name || "");
      setDescription(recoveryData.description || "");
      if (recoveryData.draftId) setServerDraftId(recoveryData.draftId);
      toast.success("Progress recovered");
    }
    setShowRecovery(false);
  }

  function dismissRecovery() {
    localStorage.removeItem(LS_KEY);
    setShowRecovery(false);
    setRecoveryData(null);
  }

  // Save to localStorage (debounced)
  function saveToLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        answers: a, name, description,
        draftId: serverDraftId,
        timestamp: Date.now(),
      }));
    } catch {}
  }

  // Save to server
  async function saveToServer() {
    if (!name.trim()) return; // Need at least a name
    setSaveStatus("saving");
    try {
      if (serverDraftId) {
        await updateDraft(serverDraftId, { name, description, artifactType: a.q1 || "other", intakeAnswers: a });
      } else {
        const res = await saveDraft({ name, description, artifactType: a.q1 || "other", intakeAnswers: a });
        setServerDraftId(res.tool.id);
      }
      const now = Date.now();
      lastServerSaveRef.current = now;
      setLastSaved(new Date(now));
      setSaveStatus("saved");
    } catch (err) {
      setSaveStatus("unsaved");
      console.error("[autosave] server save failed:", err.message);
    }
  }

  // Track changes and trigger auto-save
  const markChanged = useCallback(() => {
    changeCountRef.current++;
    setSaveStatus("unsaved");

    // Debounce localStorage save
    clearTimeout(localSaveTimerRef.current);
    localSaveTimerRef.current = setTimeout(() => saveToLocal(), AUTOSAVE_LOCAL_MS);

    // Schedule server save if enough time has passed
    clearTimeout(serverSaveTimerRef.current);
    const sinceLast = Date.now() - lastServerSaveRef.current;
    const delay = Math.max(AUTOSAVE_SERVER_MS - sinceLast, 5000);
    serverSaveTimerRef.current = setTimeout(() => saveToServer(), delay);
  }, [a, name, description, serverDraftId]);

  // Wrap setters to trigger auto-save
  const s = useCallback((k, v) => {
    setA(p => ({ ...p, [k]: v }));
    // markChanged called via useEffect below
  }, []);
  const tm = useCallback((k, v) => {
    setA(p => {
      const arr = p[k] || [];
      return { ...p, [k]: arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v] };
    });
  }, []);

  // Trigger autosave on any form change
  useEffect(() => {
    if (loadingDraft || showRecovery) return;
    if (changeCountRef.current === 0 && !draftId) return; // Don't save empty form
    markChanged();
  }, [a, name, description]);

  // Warn on unsaved changes before tab close
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (saveStatus === "unsaved") {
        e.preventDefault();
        saveToLocal(); // Best-effort save to localStorage
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [saveStatus]);

  // Cleanup timers
  useEffect(() => {
    return () => {
      clearTimeout(localSaveTimerRef.current);
      clearTimeout(serverSaveTimerRef.current);
    };
  }, []);

  // Compute progress
  const showData = a.q9 === "yes";
  const showAI = a.q1 === "ai-agent" || a.q12 === "approved-dpa" || a.q12 === "unknown-dpa" || a.q12 === "no-dpa";

  const visibleQuestions = useMemo(() => {
    const qs = ["q1","q2","q3","q4","q5","q6","q7","q8","q9"];
    if (showData) qs.push("q10","q11","q12","q13");
    qs.push("q14","q15","q16","q17","q18");
    if (showAI) qs.push("q19","q20","q21");
    return qs;
  }, [showData, showAI]);

  const answeredCount = visibleQuestions.filter(q => isAnswered(a, q)).length;
  const totalCount = visibleQuestions.length;
  const progressPct = totalCount > 0 ? (answeredCount / totalCount) * 100 : 0;

  const result = computeTrack(a);

  // Clear field error when user answers
  const clearFieldError = useCallback((key) => {
    setFieldErrors(prev => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // Watch for answers to clear field-level errors
  useEffect(() => {
    for (const key of Object.keys(fieldErrors)) {
      if (key === "name" && name.trim()) clearFieldError("name");
      else if (isAnswered(a, key)) clearFieldError(key);
    }
  }, [a, name, fieldErrors]);

  async function handleSubmit() {
    // Validate required fields
    const errors = {};
    if (!name.trim()) errors.name = "Tool name is required";
    const unanswered = REQUIRED_QUESTIONS.filter(q => visibleQuestions.includes(q) && !isAnswered(a, q));
    for (const q of unanswered) errors[q] = `Question ${q.replace("q", "")} is required`;

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      // Focus first invalid field
      const firstKey = !name.trim() ? "tool-name" : `q${unanswered[0]?.replace("q", "")}-label`;
      const el = document.getElementById(firstKey);
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.focus({ preventScroll: true }); }
      toast.error(`${Object.keys(errors).length} field${Object.keys(errors).length > 1 ? "s" : ""} need attention`);
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    try {
      const res = await submitIntake({
        draftId: serverDraftId,
        name,
        description,
        artifactType: a.q1 || "other",
        intakeAnswers: a,
      });
      // Clear localStorage on successful submit
      localStorage.removeItem(LS_KEY);
      toast.success(`"${name}" submitted — Track ${res.track}`);
      navigate(`/upload/${res.tool.id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveDraft() {
    if (!name.trim()) { toast.error("Enter a tool name to save draft"); return; }
    await saveToServer();
    saveToLocal();
    toast.success("Draft saved");
  }

  if (loadingDraft) {
    return <div className="page" style={{ maxWidth: 960 }}><div style={{ padding: 40, textAlign: "center", color: C.textDim }}>Loading draft...</div></div>;
  }

  return (
    <div className="page" style={{ maxWidth: 960 }}>
      {/* Recovery prompt */}
      {showRecovery && recoveryData && (
        <div style={{
          padding: "14px 18px", borderRadius: 10, marginBottom: 20,
          background: C.warningBg, border: `1px solid ${C.warning}`,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
              <Clock size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
              You have unsaved progress from {formatTime(new Date(recoveryData.timestamp))}
            </div>
            <div style={{ fontSize: 12, color: C.textMid, marginTop: 2 }}>
              {recoveryData.name ? `"${recoveryData.name}" — ` : ""}
              {Object.keys(recoveryData.answers || {}).length} questions answered
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <Btn onClick={recoverFromLocal}>Resume</Btn>
            <Btn variant="ghost" onClick={dismissRecovery}>Start fresh</Btn>
          </div>
        </div>
      )}

      <header>
        <div className="eyebrow">AI Tool Intake</div>
        <h1 style={{ margin: "6px 0 0", fontSize: 22, letterSpacing: "-0.02em" }}>
          {draftId ? "Edit draft" : "Submit a new tool for review"}
        </h1>
        <p className="body-copy">Answer the questions below. Your responses determine the review track.</p>
      </header>

      <div style={{ display: "flex", gap: 24 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Tool basics */}
          <SectionDivider num="0" title="Tool Identity" sub="Name and describe your tool." />
          <div style={{ marginBottom: 24 }}>
            <div className="field" style={{ marginBottom: 14 }}>
              <label htmlFor="tool-name">Tool name <span style={{ fontSize: 9, color: TRACK_COLORS[3], fontWeight: 700 }}>REQUIRED</span></label>
              <input id="tool-name" className="text-field" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Advising assistant"
                aria-invalid={!!fieldErrors.name || undefined} aria-describedby={fieldErrors.name ? "tool-name-error" : undefined} />
              {fieldErrors.name && <div id="tool-name-error" role="alert" style={{ fontSize: 12, color: TRACK_COLORS[4], marginTop: 3, fontWeight: 500 }}>{fieldErrors.name}</div>}
              {!name.trim() && !fieldErrors.name && <div style={{ fontSize: 11, color: C.textDim, marginTop: 3 }}>Give your tool a descriptive name.</div>}
            </div>
            <div className="field">
              <label htmlFor="tool-desc">Description</label>
              <textarea id="tool-desc" className="text-area" value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this tool do?" style={{ minHeight: 80 }} />
            </div>
          </div>

          <SectionDivider num="1" title="What Did You Build?" sub="Classifies artifact type and sets dimension weight profile." />
          <Q n={1} label="What best describes what you built?" req answered={isAnswered(a,"q1")} hint={FIELD_HINTS.q1} error={fieldErrors.q1}>
            {[["public-site","Public-facing website or web app"],["internal-app","Internal web app (requires auth)"],["script-api","Script, automation, or API integration"],
              ["ai-agent","AI-powered tool or agent"],["data-pipeline","Data pipeline or reporting tool"],["other","Something else"]
            ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q1===v} onClick={x=>s("q1",x)} />)}
          </Q>
          <Q n={2} label="Is this tool already in production?" req answered={isAnswered(a,"q2")} hint={FIELD_HINTS.q2} error={fieldErrors.q2}>
            {[["no","No — new and not in use"],["yes","Yes — already being used"],["partial","Partially — using but not shared"]
            ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q2===v} onClick={x=>s("q2",x)} />)}
          </Q>
          <Q n={3} label="Who will use this tool?" req multi routing="Informs Blast Radius. Student/public use activates elevated review." answered={isAnswered(a,"q3")} hint={FIELD_HINTS.q3} error={fieldErrors.q3}>
            {[["just-me","Just me"],["team","My immediate team (<10)"],["department","A department or unit"],["students","Students"],["public","The general public"],["external","External partners"]
            ].map(([v,l]) => <CheckOption key={v} value={v} label={l} checked={(a.q3||[]).includes(v)} onChange={x=>tm("q3",x)} />)}
          </Q>
          <Q n={4} label="Describe what this tool does and what problem it solves." req answered={isAnswered(a,"q4")} hint={FIELD_HINTS.q4} error={fieldErrors.q4}>
            <textarea className="text-area" value={a.q4 || ""} onChange={e=>s("q4",e.target.value)} placeholder="3-5 sentences..." style={{ minHeight: 80 }} aria-labelledby="q4-label" />
          </Q>

          <SectionDivider num="2" title="Deployment and Access" sub="How and where the tool will run." />
          <Q n={5} label="Where will this tool be accessible?" req answered={isAnswered(a,"q5")} hint={FIELD_HINTS.q5} error={fieldErrors.q5}
            esc={a.q5==="public-noauth" && showData && (a.q10||[]).some(d=>d!=="public") ? "Public-facing + non-public data = Track 4" : null}>
            {[["public-noauth","Public internet — no auth"],["public-auth","Public internet — requires auth"],["campus-vpn","Campus network / VPN only"],["internal-server","Internal server — no UI"],["undetermined","Not yet determined"]
            ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q5===v} onClick={x=>s("q5",x)} />)}
          </Q>
          <Q n={6} label="Does this tool use campus SSO?" req esc={a.q6==="custom-auth"?"Auth outside campus SSO — escalation":null} answered={isAnswered(a,"q6")} hint={FIELD_HINTS.q6} error={fieldErrors.q6}>
            {[["sso","Yes — campus SSO"],["no-auth","No auth required"],["custom-auth","Custom or third-party auth"],["not-implemented","Not yet implemented"]
            ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q6===v} onClick={x=>s("q6",x)} />)}
          </Q>
          <Q n={7} label="What infrastructure does this tool require?" req multi answered={isAnswered(a,"q7")} hint={FIELD_HINTS.q7} error={fieldErrors.q7}>
            {[["web-hosting","Web hosting"],["server-runtime","Server-side runtime"],["database","Database"],["cron","Scheduled jobs"],["api-endpoints","API endpoints"],
              ["file-storage","File storage"],["email","Email / notifications"],["third-party","Third-party services"],["unknown","Unknown — need help"]
            ].map(([v,l]) => <CheckOption key={v} value={v} label={l} checked={(a.q7||[]).includes(v)} onChange={x=>tm("q7",x)} />)}
          </Q>
          <Q n={8} label="Expected number of users?" answered={isAnswered(a,"q8")}>
            {[["<50","Fewer than 50"],["50-500","50-500"],["500+","500+ or high-frequency"],["unknown","Unknown"]
            ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q8===v} onClick={x=>s("q8",x)} />)}
          </Q>

          <SectionDivider num="3" title="Data" sub="What data the tool handles, where it lives." />
          <Q n={9} label="Does this tool collect, store, access, process, or transmit any data?" req answered={isAnswered(a,"q9")} hint={FIELD_HINTS.q9} error={fieldErrors.q9}>
            {[["no","No — generates outputs only"],["yes","Yes — handles data"]
            ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q9===v} onClick={x=>s("q9",x)} />)}
          </Q>
          {showData && <>
            <Q n={10} label="What kind of data?" req multi esc={(a.q10||[]).some(d=>["hipaa","irb","export","tribal"].includes(d))?"Regulated data = Track 4":null} answered={isAnswered(a,"q10")} hint={FIELD_HINTS.q10}>
              {[["public","Public / non-sensitive"],["internal","Internal institutional"],["ferpa","FERPA student records"],["hr","Employee / HR"],["hipaa","HIPAA health data"],
                ["irb","IRB research / human subjects"],["export","Export-controlled / CUI"],["tribal","Tribal / indigenous community"],["payment","Payment / financial"],
                ["credentials","Auth credentials / identity"],["behavioral","Behavioral / performance data"]
              ].map(([v,l]) => <CheckOption key={v} value={v} label={l} checked={(a.q10||[]).includes(v)} onChange={x=>tm("q10",x)} />)}
            </Q>
            <Q n={11} label="Where does the data live?" req multi esc={(a.q11||[]).includes("personal")?"Personal accounts = Track 4":null} answered={isAnswered(a,"q11")} hint={FIELD_HINTS.q11}>
              {[["campus","Campus IT infrastructure"],["approved-third","Third-party with DPA"],["unknown-third","Third-party — DPA unknown"],["personal","Personal accounts"],["ephemeral","Process and discard"]
              ].map(([v,l]) => <CheckOption key={v} value={v} label={l} checked={(a.q11||[]).includes(v)} onChange={x=>tm("q11",x)} />)}
            </Q>
            <Q n={12} label="Does data leave campus for AI processing?" req esc={(a.q12==="no-dpa"||a.q12==="unknown-dpa")?"No DPA = Track 4":null} answered={isAnswered(a,"q12")} hint={FIELD_HINTS.q12}>
              {[["no","No external AI"],["approved-dpa","Yes — approved DPA"],["unknown-dpa","Yes — DPA unknown"],["no-dpa","Yes — no DPA"]
              ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q12===v} onClick={x=>s("q12",x)} />)}
            </Q>
            <Q n={13} label="AI model provider and model?" routing="Used to assess model drift risk." answered={isAnswered(a,"q13")}>
              <textarea className="text-area" value={a.q13 || ""} onChange={e=>s("q13",e.target.value)} placeholder="e.g., Anthropic Claude Sonnet via API..." style={{ minHeight: 60 }} aria-labelledby="q13-label" />
            </Q>
          </>}

          <SectionDivider num="4" title="Maintenance & Ownership" sub="Who owns it, what happens when you leave." />
          <Q n={14} label="Who owns this tool?" req answered={isAnswered(a,"q14")} hint={FIELD_HINTS.q14} error={fieldErrors.q14}>
            {[["me","I built it and own it"],["department","Built for a department"],["vendor","Vendor / contractor built"],["unclear","Ownership unclear"]
            ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q14===v} onClick={x=>s("q14",x)} />)}
          </Q>
          <Q n={15} label="Is the code in version control?" req esc={a.q15==="no-vc"?"No version control — blocks approval at Track 2+":null} answered={isAnswered(a,"q15")} hint={FIELD_HINTS.q15} error={fieldErrors.q15}>
            {[["campus-repo","Campus code repository"],["personal-repo","Personal GitHub/GitLab"],["dept-repo","Department repo"],["no-vc","No version control"]
            ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q15===v} onClick={x=>s("q15",x)} />)}
          </Q>
          <Q n={16} label="If you left UM tomorrow, what happens to this tool?" req answered={isAnswered(a,"q16")} hint={FIELD_HINTS.q16} error={fieldErrors.q16}>
            {[["successor","Designated successor exists"],["documented","Documented for handoff"],["nobody","Nobody else knows how it works"],["stop","Would stop being maintained"]
            ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q16===v} onClick={x=>s("q16",x)} />)}
          </Q>
          <Q n={17} label="Expected maintenance model?" req answered={isAnswered(a,"q17")} hint={FIELD_HINTS.q17} error={fieldErrors.q17}>
            {[["set-forget","Set and forget"],["occasional","Occasional updates"],["active","Active development"],["third-party-dep","Dependent on third-party"]
            ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q17===v} onClick={x=>s("q17",x)} />)}
          </Q>
          <Q n={18} label="If this tool breaks, who fixes it?" req answered={isAnswered(a,"q18")} hint={FIELD_HINTS.q18} error={fieldErrors.q18}>
            {[["me-available","Me — available to respond"],["team-runbooks","Team with documented processes"],["only-me","Me — only one who knows"],["unknown","Unknown"]
            ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q18===v} onClick={x=>s("q18",x)} />)}
          </Q>

          {showAI && <>
            <SectionDivider num="5" title="AI-Specific Questions" sub="Your tool uses AI or sends data to an external AI model." />
            <Q n={19} label="Explain in plain language what the tool does and what happens when it fails." req routing="Builder Comprehension check." answered={isAnswered(a,"q19")} hint={FIELD_HINTS.q19}>
              <textarea className="text-area" value={a.q19 || ""} onChange={e=>s("q19",e.target.value)} placeholder="Walk a non-technical reviewer through the tool..." style={{ minHeight: 100 }} aria-labelledby="q19-label" />
            </Q>
            <Q n={20} label="What decisions does this tool make or influence? Human reviewer at decision point?" req answered={isAnswered(a,"q20")} hint={FIELD_HINTS.q20}>
              <textarea className="text-area" value={a.q20 || ""} onChange={e=>s("q20",e.target.value)} placeholder="Describe decisions and human oversight..." style={{ minHeight: 80 }} aria-labelledby="q20-label" />
            </Q>
            <Q n={21} label="Will users know they're interacting with AI?" req esc={a.q21==="no"?"Users unaware of AI — pedagogy escalation":null} answered={isAnswered(a,"q21")} hint={FIELD_HINTS.q21}>
              {[["yes","Yes — clearly disclosed"],["no","No — users won't know"],["partial","Partially"],["na","N/A — no direct interaction"]
              ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q21===v} onClick={x=>s("q21",x)} />)}
            </Q>
          </>}

          <div style={{ marginTop: 36, paddingTop: 20, borderTop: `1px solid ${C.border}`, display: "flex", gap: 10, alignItems: "center" }}>
            <Btn onClick={handleSubmit} disabled={submitting || !name.trim()}>
              {submitting ? "Submitting..." : "Submit Intake & Upload Code"}
            </Btn>
            <Btn variant="ghost" onClick={handleSaveDraft} disabled={!name.trim()}>
              <Save size={13} style={{ marginRight: 4, verticalAlign: -1 }} /> Save Draft
            </Btn>
          </div>
        </div>

        {/* Live scoring sidebar */}
        <div style={{ width: 210, flexShrink: 0 }}>
          <div className="sticky-column">
            <div style={{ padding: 14, borderRadius: 10, background: C.surface, border: `1px solid ${C.border}` }}>
              {/* Progress bar */}
              <div className="section-label" style={{ marginBottom: 6 }}>Progress</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <div role="progressbar" aria-valuenow={Math.round(progressPct)} aria-valuemin={0} aria-valuemax={100} aria-label="Form completion progress" style={{ flex: 1, height: 6, borderRadius: 3, background: C.border, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${progressPct}%`, borderRadius: 3,
                    background: progressPct === 100 ? C.success : C.accent, transition: "width .3s" }} />
                </div>
                <span className="mono" style={{ fontSize: 11, color: C.textMid, flexShrink: 0 }}>{answeredCount}/{totalCount}</span>
              </div>
              <div style={{ fontSize: 11, color: progressPct === 100 ? C.success : C.textDim, marginBottom: 12 }}>
                {progressPct === 100 ? "All questions answered" : `${totalCount - answeredCount} remaining`}
              </div>

              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, marginBottom: 10 }}>
                <div className="section-label" style={{ marginBottom: 10 }}>Live Routing</div>
                <TrackBadge track={result.track} />
                <div className="mono" style={{ marginTop: 10, fontSize: 11, color: C.textMid }}>
                  Score: {result.total} / {result.max}
                </div>
                <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: C.border, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${result.pct * 100}%`, borderRadius: 2, background: TRACK_COLORS[result.track], transition: "all .3s" }} />
                </div>
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

              {/* Save indicator */}
              <SaveIndicator status={saveStatus} lastSaved={lastSaved} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
