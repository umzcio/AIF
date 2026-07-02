/**
 * AIF Scoring Engine — shared by intake routes, orchestrator, and CLI.
 *
 * Seven weighted dimensions, artifact-type weight profiles,
 * percentage-based routing to Track 1-4.
 */

export const WEIGHT_PROFILES = {
  "public-site":   { security: 4, accessibility: 4, dataSensitivity: 3, blastRadius: 3, autonomy: 1, comprehension: 2, maintenance: 3 },
  "internal-app":  { security: 3, accessibility: 3, dataSensitivity: 4, blastRadius: 2, autonomy: 1, comprehension: 2, maintenance: 3 },
  "script-api":    { security: 3, accessibility: 0, dataSensitivity: 3, blastRadius: 2, autonomy: 2, comprehension: 2, maintenance: 3 },
  "ai-agent":      { security: 3, accessibility: 1, dataSensitivity: 3, blastRadius: 4, autonomy: 4, comprehension: 4, maintenance: 3 },
  "data-pipeline": { security: 3, accessibility: 0, dataSensitivity: 4, blastRadius: 2, autonomy: 2, comprehension: 2, maintenance: 3 },
  "other":         { security: 3, accessibility: 2, dataSensitivity: 3, blastRadius: 2, autonomy: 1, comprehension: 2, maintenance: 3 },
};

export const SCORE_DIMENSIONS = [
  "security", "accessibility", "dataSensitivity", "blastRadius",
  "autonomy", "comprehension", "maintenance",
];

export const AUTONOMY_LEVELS = { "none": 0, "recommends": 1, "acts-with-override": 2, "autonomous": 3 };

export function computeDimensionScores(a) {
  const s = { security: 0, accessibility: 0, dataSensitivity: 0, blastRadius: 0, autonomy: 0, comprehension: 0, maintenance: 0 };
  // Security
  if (a.q5 === "public-noauth") s.security = 3;
  else if (a.q5 === "public-auth") s.security = 2;
  else if (a.q5 === "campus-vpn") s.security = 1;
  else if (a.q5 === "undetermined") s.security = 2;
  if (a.q6 === "no-auth" || a.q6 === "custom-auth") s.security = Math.min(s.security + 1, 3);
  // Accessibility
  if (a.q5 === "public-noauth" || a.q5 === "public-auth") s.accessibility = 3;
  else if (a.q1 === "internal-app") s.accessibility = 2;
  // Data Sensitivity
  const dt = a.q10 || [];
  if (dt.some(d => ["hipaa","irb","export","tribal"].includes(d))) s.dataSensitivity = 3;
  else if (dt.some(d => ["ferpa","hr","payment","credentials","behavioral"].includes(d))) s.dataSensitivity = 2;
  else if (dt.includes("internal")) s.dataSensitivity = 1;
  if (a.q9 === "no") s.dataSensitivity = 0;
  // Blast Radius
  const u = a.q3 || [];
  if (u.some(x => ["public","external"].includes(x))) s.blastRadius = 3;
  else if (u.includes("students") || u.includes("department")) s.blastRadius = 2;
  else if (u.includes("team")) s.blastRadius = 1;
  if (a.q8 === "500+") s.blastRadius = Math.min(s.blastRadius + 1, 3);
  // Autonomy: decision scope (q20 enum) + disclosure penalty.
  // Legacy records hold free-text q20; keep the old length heuristic for them.
  let auto;
  if (Object.hasOwn(AUTONOMY_LEVELS, a.q20)) auto = AUTONOMY_LEVELS[a.q20];
  else auto = a.q20 && a.q20.length > 10 ? 1 : 0;
  if (a.q21 === "no") auto += 1;
  s.autonomy = Math.min(auto, 3);
  // Comprehension
  if (!a.q19 || a.q19.length < 20) s.comprehension = 3;
  else if (a.q19.length < 80) s.comprehension = 2;
  else if (a.q19.length < 200) s.comprehension = 1;
  // Maintenance
  let m = 0;
  if (a.q15 === "no-vc") m += 1;
  if (a.q16 === "nobody" || a.q16 === "stop") m += 1;
  if (a.q17 === "third-party-dep") m += 0.5;
  if (a.q18 === "only-me" || a.q18 === "unknown") m += 0.5;
  s.maintenance = Math.min(Math.round(m), 3);
  return s;
}

export function checkEscalations(a) {
  const e = [];
  const dt = a.q10 || [];
  if (dt.some(d => ["hipaa","irb","export","tribal"].includes(d))) e.push("Regulated data (HIPAA/IRB/Export/Tribal)");
  if (dt.includes("ferpa") && (a.q5 === "public-noauth" || (a.q5 === "public-auth" && a.q6 !== "sso"))) e.push("FERPA + public-facing deployment");
  if ((a.q11 || []).includes("personal")) e.push("Institutional data in personal accounts");
  if (a.q12 === "no-dpa" || a.q12 === "unknown-dpa") e.push("AI model without approved DPA");
  if (a.q6 === "custom-auth") e.push("Auth outside campus SSO");
  if (a.q15 === "no-vc") e.push("No version control");
  if (a.q21 === "no" && (a.q3 || []).includes("students")) e.push("Students unaware of AI");
  if (dt.includes("payment")) e.push("Payment card data (PCI DSS)");
  if (a.q20 === "autonomous") e.push("Autonomous decisions without human review");
  return e;
}

/**
 * Floor conditions: raise the minimum track without forcing Track 4.
 * FERPA on an internet-reachable but SSO-protected deployment gets IT review
 * (Track 3) rather than formal project governance — see escalation-conditions.md.
 */
export function checkFloors(a) {
  const f = [];
  const dt = a.q10 || [];
  if (dt.includes("ferpa") && a.q5 === "public-auth" && a.q6 === "sso") {
    f.push({ track: 3, reason: "FERPA data on internet-reachable SSO deployment" });
  }
  return f;
}

export const VALID_ARTIFACT_TYPES = Object.keys(WEIGHT_PROFILES);

export function computeWeightedPercentage(scores, artifactType) {
  const key = VALID_ARTIFACT_TYPES.includes(artifactType) ? artifactType : "other";
  const w = WEIGHT_PROFILES[key];
  let total = 0, max = 0;
  for (const k of SCORE_DIMENSIONS) {
    total += (scores[k] || 0) * (w[k] || 0);
    max += 3 * (w[k] || 0);
  }
  return max > 0 ? total / max : 0;
}

export function routeToTrack(weightedPct, hasEscalation, floorTrack = 1) {
  if (hasEscalation) return 4;
  let track;
  if (weightedPct >= 0.65) track = 4;
  else if (weightedPct >= 0.42) track = 3;
  else if (weightedPct >= 0.22) track = 2;
  else track = 1;
  return Math.max(track, floorTrack);
}

/**
 * Anti-gaming guard: the weight profile is not purely self-declared.
 * Profiles implied by the answers themselves (deployment surface, AI use)
 * are always evaluated alongside the declared type, and routing uses the
 * highest resulting percentage. Switching q1 alone can never lower the track.
 */
export function applicableProfiles(a, declaredType) {
  const declared = VALID_ARTIFACT_TYPES.includes(declaredType) ? declaredType
    : VALID_ARTIFACT_TYPES.includes(a.q1) ? a.q1 : "other";
  const set = new Set([declared]);
  const aiClassified = a.q1 === "ai-agent" || ["approved-dpa", "unknown-dpa", "no-dpa"].includes(a.q12);
  if (aiClassified) set.add("ai-agent");
  if (a.q5 === "public-noauth") set.add("public-site");
  if (a.q5 === "public-auth" || a.q5 === "campus-vpn") set.add("internal-app");
  return [...set];
}

export function computeEffectivePercentage(scores, answers, declaredType) {
  let best = null;
  for (const profile of applicableProfiles(answers, declaredType)) {
    const pct = computeWeightedPercentage(scores, profile);
    if (best === null || pct > best.pct) best = { pct, profile };
  }
  return best;
}

export function computeTrack(answers, artifactType) {
  const scores = computeDimensionScores(answers);
  const escalations = checkEscalations(answers);
  const floors = checkFloors(answers);
  const { pct, profile } = computeEffectivePercentage(scores, answers, artifactType || answers.q1 || "other");
  const floorTrack = floors.reduce((m, f) => Math.max(m, f.track), 1);
  const track = routeToTrack(pct, escalations.length > 0, floorTrack);
  return { track, scores, escalations, floors, weightedPct: pct, profileUsed: profile };
}
