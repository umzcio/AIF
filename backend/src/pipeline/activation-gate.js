/**
 * Track 1 auto-activation gate (FW-02).
 *
 * The pipeline independently derives the signals needed to check the intake's
 * self-reported answers (SSO usage, data classifications, AI disclosure).
 * This module diffs Agent 1's synthesis against the intake and decides whether
 * a Track 1 tool may auto-activate. Fail-safe: contradictions, confirmed
 * criticals, partial analysis, or truncated coverage all route to human review.
 */

const SENSITIVE_CLASSES = ["PII", "FERPA", "HIPAA", "financial", "research"];
// intake q10 value implied by each pipeline data classification
const CLASS_TO_Q10 = { FERPA: "ferpa", HIPAA: "hipaa", financial: "payment", research: "irb" };

export function findContradictions(answers, codeSynthesis) {
  const c = [];
  if (!answers || !codeSynthesis) return c;
  const auth = codeSynthesis.authentication || {};
  const esc = codeSynthesis.escalationSignals || {};
  const dataOps = Array.isArray(codeSynthesis.dataOperations) ? codeSynthesis.dataOperations : [];
  const ai = codeSynthesis.aiUsage || {};

  if (answers.q6 === "sso" && (auth.hasInstitutionalSSO === false || esc.noInstitutionalSSO?.triggered === true)) {
    c.push({
      question: "q6", answered: "sso",
      observed: auth.primary || "no institutional SSO detected",
      evidence: auth.ssoEvidence || esc.noInstitutionalSSO?.evidence || null,
      detail: "Intake claims campus SSO; code analysis found no institutional SSO.",
    });
  }

  const sensitiveOps = dataOps.filter(op => SENSITIVE_CLASSES.includes(op.classification));
  const declared = Array.isArray(answers.q10) ? answers.q10 : [];
  if (sensitiveOps.length > 0 && (answers.q9 === "no" || declared.every(t => t === "public"))) {
    c.push({
      question: "q9/q10", answered: answers.q9 === "no" ? "no data" : "public data only",
      observed: [...new Set(sensitiveOps.map(o => o.classification))].join(", "),
      evidence: sensitiveOps[0].where || null,
      detail: "Intake claims no sensitive data; code analysis found sensitive data operations.",
    });
  } else {
    for (const [cls, q10val] of Object.entries(CLASS_TO_Q10)) {
      const ops = dataOps.filter(op => op.classification === cls);
      if (ops.length > 0 && declared.length > 0 && !declared.includes(q10val)) {
        c.push({
          question: "q10", answered: declared.join(", "),
          observed: cls, evidence: ops[0].where || null,
          detail: `Code analysis found ${cls}-classified data operations not declared on the intake.`,
        });
      }
    }
  }

  if (answers.q21 === "yes" && esc.studentFacingNoDisclosure?.triggered === true) {
    c.push({
      question: "q21", answered: "yes (disclosed)",
      observed: "student-facing AI without disclosure",
      evidence: esc.studentFacingNoDisclosure?.evidence || null,
      detail: "Intake claims users are told they interact with AI; code analysis found no disclosure.",
    });
  }

  if (answers.q12 === "no" && ai.dataTransmittedToAI === true) {
    c.push({
      question: "q12", answered: "no external AI",
      observed: "data transmitted to an AI provider",
      evidence: ai.transmissionEvidence || null,
      detail: "Intake claims no data leaves campus for AI processing; code analysis found AI transmission.",
    });
  }

  return c;
}

export function evaluateActivationGate({ track, answers, codeSynthesis, partial, truncated }) {
  const contradictions = findContradictions(answers, codeSynthesis);
  const reasons = [];
  if (contradictions.length) reasons.push(`${contradictions.length} intake-vs-code contradiction(s)`);
  const criticals = (codeSynthesis?.findings || []).filter(
    f => (f.severity || "").toLowerCase() === "critical" && f.confidence === "confirmed"
  );
  if (criticals.length) reasons.push(`${criticals.length} confirmed critical finding(s)`);
  if (partial) reasons.push("partial analysis (not all model passes completed)");
  if (truncated) reasons.push("codebase bundle truncated (incomplete coverage for passes 2-5)");
  if (!codeSynthesis || codeSynthesis.metadata?.synthesis_failed) {
    reasons.push("code-analysis synthesis unavailable — contradiction check could not run");
  }
  const applies = track === 1;
  return {
    activate: applies && reasons.length === 0,
    blocked: applies && reasons.length > 0,
    reasons,
    contradictions,
  };
}
