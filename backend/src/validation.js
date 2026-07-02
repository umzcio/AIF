import { z } from "zod";

// Middleware factory: validates req.body against a schema
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`);
      return res.status(400).json({ error: errors.join("; ") });
    }
    req.validated = result.data;
    next();
  };
}

// Schemas
export const reviewDecisionSchema = z.object({
  decision: z.enum(["approved", "changes_requested"]),
  notes: z.string().optional(),
});

export const trackOverrideSchema = z.object({
  newTrack: z.number().int().min(1).max(4),
  reason: z.string().min(1, "reason is required"),
});

export const reviewNoteSchema = z.object({
  body: z.string().min(1, "body is required"),
});

export const selfCertifySchema = z.object({
  attestation: z.string().min(20, "attestation must describe what was reviewed (min 20 chars)").max(4000),
  confirmFindingsReviewed: z.literal(true),
  confirmEscalationsUnderstood: z.literal(true),
});

export const toolStatusSchema = z.object({
  status: z.string().min(1, "status is required"),
});

export const userRoleSchema = z.object({
  role: z.enum(["builder", "reviewer", "admin"]),
});

export const userActiveSchema = z.object({
  active: z.boolean(),
});

export const notificationReadSchema = z.object({
  ids: z.union([
    z.literal("all"),
    z.array(z.string().uuid()).min(1),
  ]),
});

export const notificationPrefsSchema = z.object({
  notify_email: z.boolean().optional(),
  notify_in_app: z.boolean().optional(),
}).refine(
  data => data.notify_email !== undefined || data.notify_in_app !== undefined,
  { message: "No valid preferences provided" }
);

export const emailUpdateSchema = z.object({
  email: z.string().email().or(z.literal("")),
});

export const pipelineRunSchema = z.object({
  mode: z.enum(["direct-api"]).default("direct-api"),
});

export const toolEditSchema = z.object({
  name: z.string().min(1, "name is required").max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
}).refine(
  data => data.name !== undefined || data.description !== undefined,
  { message: "No fields to update" }
);

export const sandboxToggleSchema = z.object({
  sandbox: z.boolean(),
});

export const findingStatusSchema = z.object({
  statuses: z.record(
    z.string().min(1),
    z.enum(["open", "resolved", "wontfix"])
  ).refine(obj => Object.keys(obj).length > 0 && Object.keys(obj).length <= 500, {
    message: "Must contain 1-500 finding statuses",
  }),
});

// ---------------------------------------------------------------------------
// Intake answers (FW-03) — authoritative "phantom-required questions" check.
// Applied ONLY on submit (drafts stay lenient); see validateIntakeAnswers().
// ---------------------------------------------------------------------------

const Q10_VALUES = ["public","internal","ferpa","hr","hipaa","irb","export","tribal","payment","credentials","behavioral"];
const Q11_VALUES = ["campus","approved-third","unknown-third","personal","ephemeral"];

const intakeAnswersBase = z.object({
  q1: z.enum(["public-site","internal-app","script-api","ai-agent","data-pipeline","other"]),
  q2: z.enum(["no","yes","partial"]),
  q3: z.array(z.enum(["just-me","team","department","students","public","external"])).min(1),
  q4: z.string().min(1),
  q5: z.enum(["public-noauth","public-auth","campus-vpn","internal-server","undetermined"]),
  q6: z.enum(["sso","no-auth","custom-auth","not-implemented"]),
  q7: z.array(z.string().min(1)).min(1),
  q8: z.enum(["<50","50-500","500+","unknown"]).optional(),
  q9: z.enum(["no","yes"]),
  q10: z.array(z.enum(Q10_VALUES)).optional(),
  q11: z.array(z.enum(Q11_VALUES)).optional(),
  q12: z.enum(["no","approved-dpa","unknown-dpa","no-dpa"]).optional(),
  q13: z.string().optional(),
  q14: z.enum(["me","department","vendor","unclear"]),
  q15: z.enum(["campus-repo","personal-repo","dept-repo","no-vc"]),
  q16: z.enum(["successor","documented","nobody","stop"]),
  q17: z.enum(["set-forget","occasional","active","third-party-dep"]),
  q18: z.enum(["me-available","team-runbooks","only-me","unknown"]),
  q19: z.string().min(1),
  q20: z.enum(["none","recommends","acts-with-override","autonomous"]).optional(),
  q21: z.enum(["yes","no","partial","na"]).optional(),
}).passthrough();

/**
 * Authoritative intake validation, applied on submit only (drafts stay lenient).
 * Conditional requirements mirror the form: data questions when q9=yes,
 * AI questions when the submission is AI-classified. This is what makes the
 * escalation conditions non-skippable (FW-03).
 */
export function validateIntakeAnswers(answers) {
  if (!answers || typeof answers !== "object") {
    return { ok: false, errors: ["intakeAnswers: required"] };
  }
  const result = intakeAnswersBase.safeParse(answers);
  const errors = result.success ? [] :
    result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`);
  const a = result.success ? result.data : answers;

  if (a.q9 === "yes") {
    if (!Array.isArray(a.q10) || a.q10.length === 0) errors.push("q10: required when q9 is yes");
    if (!Array.isArray(a.q11) || a.q11.length === 0) errors.push("q11: required when q9 is yes");
    if (!a.q12) errors.push("q12: required when q9 is yes");
  }
  const aiClassified = a.q1 === "ai-agent" || ["approved-dpa","unknown-dpa","no-dpa"].includes(a.q12);
  if (aiClassified) {
    if (!a.q20) errors.push("q20: required for AI-classified tools");
    if (!a.q21) errors.push("q21: required for AI-classified tools");
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}
