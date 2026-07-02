import { useEffect, useState } from "react";
import { C, TRACK_COLORS, TRACK_LABELS, STATUS_META } from "../constants.js";
import { Btn, TrackBadge, relativeTime } from "./primitives.jsx";
import { getReviewNotes, addReviewNote, submitReviewDecision, overrideTrack, selfCertify, activateTool } from "../api.js";
import { useAuth } from "../hooks/useAuth.jsx";
import { useToast } from "./Toast.jsx";

export default function ReviewPanel({ tool, onUpdate }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [notes, setNotes] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [decisionNotes, setDecisionNotes] = useState("");
  const [overrideTrackVal, setOverrideTrackVal] = useState(tool.track || 1);
  const [overrideReason, setOverrideReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [overrideError, setOverrideError] = useState(false);
  const [attestation, setAttestation] = useState("");
  const [certChecks, setCertChecks] = useState({ findings: false, escalations: false });

  const isReviewerOrAdmin = user && (user.role === "reviewer" || user.role === "admin");
  const isOwner = user && tool.owner_id === user.userId;
  const canSelfCertify = isOwner && tool.track === 2 && tool.status === "under_review";
  const canDecide = isReviewerOrAdmin && tool.status === "under_review";
  const canActivate = isReviewerOrAdmin && tool.status === "approved";

  useEffect(() => { loadNotes(); }, [tool.id]);

  function loadNotes() {
    getReviewNotes(tool.id).then(d => setNotes(d.notes || [])).catch(() => {});
  }

  async function handleComment() {
    if (!newComment.trim()) return;
    setSubmitting(true);
    try {
      await addReviewNote(tool.id, newComment.trim());
      setNewComment("");
      loadNotes();
    } catch (err) { toast.error(err.message); }
    finally { setSubmitting(false); }
  }

  async function handleDecision(decision) {
    setSubmitting(true);
    try {
      const result = await submitReviewDecision(tool.id, decision, decisionNotes);
      setDecisionNotes("");
      toast.success(`Tool ${decision === "approved" ? "approved" : "changes requested"}`);
      loadNotes();
      onUpdate?.(result.tool);
    } catch (err) { toast.error(err.message); }
    finally { setSubmitting(false); }
  }

  async function handleSelfCertify() {
    setSubmitting(true);
    try {
      const result = await selfCertify(tool.id, {
        attestation: attestation.trim(),
        confirmFindingsReviewed: certChecks.findings,
        confirmEscalationsUnderstood: certChecks.escalations,
      });
      toast.success("Self-certification complete — tool is now active");
      loadNotes();
      onUpdate?.(result.tool);
    } catch (err) { toast.error(err.message); }
    finally { setSubmitting(false); }
  }

  async function handleActivate() {
    setSubmitting(true);
    try {
      const result = await activateTool(tool.id);
      toast.success("Tool activated");
      loadNotes();
      onUpdate?.(result.tool);
    } catch (err) { toast.error(err.message); }
    finally { setSubmitting(false); }
  }

  async function handleOverride() {
    if (!overrideReason.trim()) { setOverrideError(true); return; }
    setSubmitting(true);
    try {
      const result = await overrideTrack(tool.id, overrideTrackVal, overrideReason.trim());
      toast.success(`Track overridden to Track ${overrideTrackVal}`);
      setOverrideReason("");
      setShowOverride(false);
      loadNotes();
      onUpdate?.(result.tool);
    } catch (err) { toast.error(err.message); }
    finally { setSubmitting(false); }
  }

  return (
    <section className="section-card">
      <div className="card-header"><div><h2>Review</h2></div></div>
      <div className="section-stack" style={{ gap: 16 }}>

        {/* Decision buttons */}
        {canDecide && (
          <div style={{ padding: "0 16px" }}>
            <label htmlFor="review-decision-notes" style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.textMid, marginBottom: 4 }}>Decision notes</label>
            <textarea id="review-decision-notes" value={decisionNotes} onChange={e => setDecisionNotes(e.target.value)}
              placeholder="Decision notes (optional)..."
              style={{ width: "100%", minHeight: 60, padding: 10, borderRadius: 8,
                border: `1px solid ${C.border}`, background: C.surface, color: C.text,
                fontSize: 13, fontFamily: "'DM Sans', sans-serif", resize: "vertical", boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <Btn onClick={() => handleDecision("approved")} disabled={submitting}>Approve</Btn>
              <Btn variant="ghost" onClick={() => handleDecision("changes_requested")} disabled={submitting}
                style={{ color: C.warning, borderColor: C.warning }}>Request Changes</Btn>
            </div>
          </div>
        )}

        {/* Activate approved tool */}
        {canActivate && !tool.sandbox && (
          <div style={{ padding: "0 16px" }}>
            <Btn onClick={handleActivate} disabled={submitting}>Activate Tool</Btn>
          </div>
        )}
        {canActivate && tool.sandbox && (
          <div style={{ padding: "0 16px" }}>
            <div className="info-banner" style={{ borderColor: "#7C3AED" }}>
              <div style={{ fontSize: 12, color: "#7C3AED" }}><strong>Sandbox mode active.</strong> Remove sandbox mode before activating.</div>
            </div>
          </div>
        )}

        {/* Self-certify (Track 2 owner) */}
        {canSelfCertify && (
          <div style={{ padding: "0 16px" }}>
            <div className="info-banner" style={{ marginBottom: 8 }}>
              <div>
                <strong>Track 2 — Self-Certification</strong>
                <div style={{ fontSize: 12, marginTop: 4, color: C.textMid }}>
                  Review the pipeline findings, confirm the statements below, and describe what you reviewed. This attestation is stored on the audit record.
                </div>
              </div>
            </div>
            <label style={{ display: "flex", gap: 8, fontSize: 12, marginBottom: 6, alignItems: "flex-start" }}>
              <input type="checkbox" checked={certChecks.findings} onChange={e => setCertChecks(p => ({ ...p, findings: e.target.checked }))} style={{ marginTop: 2 }} />
              I have read every finding in the pipeline report for this tool.
            </label>
            <label style={{ display: "flex", gap: 8, fontSize: 12, marginBottom: 8, alignItems: "flex-start" }}>
              <input type="checkbox" checked={certChecks.escalations} onChange={e => setCertChecks(p => ({ ...p, escalations: e.target.checked }))} style={{ marginTop: 2 }} />
              I understand the escalation conditions and confirm none apply beyond what is recorded.
            </label>
            <label htmlFor="self-cert-attestation" style={{ display: "block", fontSize: 11, fontWeight: 600, color: C.textMid, marginBottom: 3 }}>Attestation (what did you review, what will you monitor?)</label>
            <textarea id="self-cert-attestation" value={attestation} onChange={e => setAttestation(e.target.value)}
              placeholder="e.g. Reviewed all 12 findings; the two warnings about rate limiting are accepted risks because..."
              style={{ width: "100%", minHeight: 60, padding: 8, borderRadius: 6, border: `1px solid ${C.border}`,
                background: C.bg, color: C.text, fontSize: 12, fontFamily: "'DM Sans', sans-serif", resize: "vertical", boxSizing: "border-box", marginBottom: 8 }} />
            <Btn onClick={handleSelfCertify} disabled={submitting || !certChecks.findings || !certChecks.escalations || attestation.trim().length < 20}>
              Self-Certify &amp; Activate
            </Btn>
          </div>
        )}

        {/* Track override (reviewer/admin) */}
        {isReviewerOrAdmin && (
          <div style={{ padding: "0 16px" }}>
            {!showOverride ? (
              <button type="button" onClick={() => setShowOverride(true)}
                style={{ fontSize: 12, color: C.textMid, background: "none", border: "none",
                  cursor: "pointer", fontFamily: "'DM Sans', sans-serif", textDecoration: "underline" }}>
                Override track assignment
              </button>
            ) : (
              <div style={{ padding: 12, borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Track Override</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  {[1,2,3,4].map(t => (
                    <button key={t} onClick={() => setOverrideTrackVal(t)}
                      style={{ padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
                        fontFamily: "'DM Sans', sans-serif",
                        border: `1.5px solid ${overrideTrackVal === t ? TRACK_COLORS[t] : C.border}`,
                        background: overrideTrackVal === t ? `${TRACK_COLORS[t]}15` : "transparent",
                        color: overrideTrackVal === t ? TRACK_COLORS[t] : C.textMid }}>
                      Track {t}
                    </button>
                  ))}
                </div>
                <label htmlFor="review-override-reason" style={{ display: "block", fontSize: 11, fontWeight: 600, color: C.textMid, marginBottom: 3 }}>Reason for override</label>
                <textarea id="review-override-reason" value={overrideReason} onChange={e => { setOverrideReason(e.target.value); if (e.target.value.trim()) setOverrideError(false); }}
                  placeholder="Reason for override (required)..."
                  aria-invalid={overrideError || undefined}
                  aria-describedby={overrideError ? "override-reason-error" : undefined}
                  style={{ width: "100%", minHeight: 50, padding: 8, borderRadius: 6,
                    border: `1px solid ${overrideError ? C.danger : C.border}`, background: C.bg, color: C.text,
                    fontSize: 12, fontFamily: "'DM Sans', sans-serif", resize: "vertical", boxSizing: "border-box" }} />
                {overrideError && <div id="override-reason-error" role="alert" style={{ fontSize: 11, color: C.danger, marginTop: 3, fontWeight: 500 }}>Reason is required for track override.</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <Btn size="sm" onClick={handleOverride} disabled={submitting}>Apply Override</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setShowOverride(false)}>Cancel</Btn>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Comment thread */}
        <div style={{ padding: "0 16px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Notes &amp; Comments</div>
          {notes.length === 0 ? (
            <div style={{ fontSize: 12, color: C.textDim, padding: "8px 0" }}>No notes yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: 12 }}>
              {notes.map(note => (
                <div key={note.id} style={{ padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
                  {note.note_type === "comment" ? (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{note.author_name || note.author_netid}</span>
                        <span style={{ fontSize: 11, color: C.textDim }}>{relativeTime(note.created_at)}</span>
                      </div>
                      <div style={{ fontSize: 13, color: C.textMid, whiteSpace: "pre-wrap" }}>{note.body}</div>
                    </>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                      <StatusEvent note={note} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* New comment input */}
          {(isReviewerOrAdmin || isOwner) && (
            <div>
              <label htmlFor="review-new-comment" style={{ display: "block", fontSize: 11, fontWeight: 600, color: C.textMid, marginBottom: 3 }}>Add a comment</label>
              <div style={{ display: "flex", gap: 8 }}>
                <textarea id="review-new-comment" value={newComment} onChange={e => setNewComment(e.target.value)}
                  placeholder="Add a comment..."
                  style={{ flex: 1, minHeight: 40, padding: 8, borderRadius: 6,
                    border: `1px solid ${C.border}`, background: C.surface, color: C.text,
                    fontSize: 12, fontFamily: "'DM Sans', sans-serif", resize: "vertical" }} />
                <Btn size="sm" onClick={handleComment} disabled={submitting || !newComment.trim()}>Post</Btn>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function StatusEvent({ note }) {
  const meta = note.metadata || {};
  const statusColor = STATUS_META[meta.to]?.color || C.textMid;

  if (note.note_type === "track_override") {
    return (
      <>
        <span style={{ color: C.textMid }}>{note.author_name || note.author_netid}</span>
        <span style={{ color: C.textDim }}>overrode track</span>
        <span style={{ fontWeight: 600, color: TRACK_COLORS[meta.from] }}>Track {meta.from}</span>
        <span style={{ color: C.textDim }}>&rarr;</span>
        <span style={{ fontWeight: 600, color: TRACK_COLORS[meta.to] }}>Track {meta.to}</span>
        <span style={{ color: C.textDim }}>{relativeTime(note.created_at)}</span>
      </>
    );
  }

  return (
    <>
      <span style={{ color: C.textMid }}>{note.author_name || note.author_netid}</span>
      <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
        background: `${statusColor}15`, color: statusColor }}>
        {STATUS_META[meta.to]?.label || meta.to || note.body}
      </span>
      <span style={{ color: C.textDim }}>{relativeTime(note.created_at)}</span>
    </>
  );
}
