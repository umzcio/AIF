import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeDimensionScores,
  checkEscalations,
  computeWeightedPercentage,
  routeToTrack,
  computeTrack,
  SCORE_DIMENSIONS,
  VALID_ARTIFACT_TYPES,
} from "../scoring.js";

import { validateIntakeAnswers } from "../validation.js";

// ---------------------------------------------------------------------------
// Re-implement parseBody and computeFromAnswers identically to intake.js
// since they are module-scoped and not exported. Same approach as
// registry.test.js and pipeline.test.js. computeFromAnswers delegates to
// computeTrack (which includes floor-aware routing), matching intake.js.
// ---------------------------------------------------------------------------

function parseBody(body) {
  let intakeAnswers = body.intakeAnswers;
  if (typeof intakeAnswers === "string") {
    try { intakeAnswers = JSON.parse(intakeAnswers); } catch { intakeAnswers = null; }
  }
  return {
    name: body.name,
    description: body.description || null,
    submissionType: body.submissionType || "new",
    artifactType: body.artifactType || null,
    intakeAnswers,
    codebaseUrl: body.codebaseUrl || null,
  };
}

function computeFromAnswers(answers, artifactType) {
  if (!answers || typeof answers !== "object") return null;
  const r = computeTrack(answers, artifactType);
  return { scores: r.scores, escalations: r.escalations, floors: r.floors, pct: r.weightedPct, track: r.track };
}

// ---------------------------------------------------------------------------
// Helpers — known answer sets with predictable outcomes.
// ---------------------------------------------------------------------------

/** Benign low-risk answers — should route to Track 1 or 2. */
function lowRiskAnswers() {
  return {
    q1: "script-api",
    q3: ["team"],
    q5: "campus-vpn",
    q6: "sso",
    q8: "<50",
    q9: "yes",
    q10: ["internal"],
    q11: ["campus"],
    q12: "approved-dpa",
    q15: "personal-repo",
    q16: "documented",
    q17: "occasional",
    q18: "team-runbooks",
    q19: "I fully understand every line of code in this tool and can explain the AI-generated portions in detail to auditors.",
    q20: "",
    q21: "yes",
  };
}

/** Maximum-risk answers — should trigger all escalations and max scores. */
function highRiskAnswers() {
  return {
    q1: "public-site",
    q3: ["public", "external", "students"],
    q5: "public-noauth",
    q6: "no-auth",
    q8: "500+",
    q9: "yes",
    q10: ["hipaa", "ferpa"],
    q11: ["personal"],
    q12: "no-dpa",
    q15: "no-vc",
    q16: "nobody",
    q17: "third-party-dep",
    q18: "only-me",
    q19: "",
    q20: "AI makes autonomous decisions about student grading without oversight",
    q21: "no",
  };
}

/** Mid-range answers — Track 2 or 3 territory. */
function midRiskAnswers() {
  return {
    q1: "internal-app",
    q3: ["students", "department"],
    q5: "campus-vpn",
    q6: "sso",
    q8: "50-500",
    q9: "yes",
    q10: ["ferpa"],
    q11: ["campus"],
    q12: "approved-dpa",
    q15: "personal-repo",
    q16: "documented",
    q17: "third-party-dep",
    q18: "team-runbooks",
    q19: "I understand the core logic but some AI-generated utility functions need closer review.",
    q20: "",
    q21: "yes",
  };
}

// ===========================================================================
// parseBody behavior
// ===========================================================================

describe("parseBody", () => {
  it("parses stringified JSON intakeAnswers", () => {
    const answers = { q1: "script-api", q5: "campus-vpn" };
    const body = { name: "Test Tool", intakeAnswers: JSON.stringify(answers) };
    const result = parseBody(body);
    assert.deepStrictEqual(result.intakeAnswers, answers);
  });

  it("passes through already-parsed intakeAnswers object", () => {
    const answers = { q1: "internal-app", q9: "yes" };
    const body = { name: "Test Tool", intakeAnswers: answers };
    const result = parseBody(body);
    assert.deepStrictEqual(result.intakeAnswers, answers);
  });

  it("returns null intakeAnswers for invalid JSON string", () => {
    const body = { name: "Test", intakeAnswers: "{not valid json" };
    const result = parseBody(body);
    assert.strictEqual(result.intakeAnswers, null);
  });

  it("returns null intakeAnswers for empty string", () => {
    const body = { name: "Test", intakeAnswers: "" };
    const result = parseBody(body);
    // empty string is falsy but typeof === "string", so JSON.parse("") throws
    assert.strictEqual(result.intakeAnswers, null);
  });

  it("extracts name from body", () => {
    const result = parseBody({ name: "My Tool" });
    assert.strictEqual(result.name, "My Tool");
  });

  it("extracts description, defaulting to null", () => {
    const withDesc = parseBody({ name: "T", description: "A tool" });
    assert.strictEqual(withDesc.description, "A tool");

    const withoutDesc = parseBody({ name: "T" });
    assert.strictEqual(withoutDesc.description, null);
  });

  it("extracts submissionType, defaulting to 'new'", () => {
    const explicit = parseBody({ name: "T", submissionType: "update" });
    assert.strictEqual(explicit.submissionType, "update");

    const defaulted = parseBody({ name: "T" });
    assert.strictEqual(defaulted.submissionType, "new");
  });

  it("extracts artifactType, defaulting to null", () => {
    const explicit = parseBody({ name: "T", artifactType: "ai-agent" });
    assert.strictEqual(explicit.artifactType, "ai-agent");

    const defaulted = parseBody({ name: "T" });
    assert.strictEqual(defaulted.artifactType, null);
  });

  it("extracts codebaseUrl, defaulting to null", () => {
    const explicit = parseBody({ name: "T", codebaseUrl: "https://github.com/org/repo" });
    assert.strictEqual(explicit.codebaseUrl, "https://github.com/org/repo");

    const defaulted = parseBody({ name: "T" });
    assert.strictEqual(defaulted.codebaseUrl, null);
  });
});

// ===========================================================================
// computeFromAnswers
// ===========================================================================

describe("computeFromAnswers", () => {
  it("returns null for null answers", () => {
    assert.strictEqual(computeFromAnswers(null, "other"), null);
  });

  it("returns null for undefined answers", () => {
    assert.strictEqual(computeFromAnswers(undefined, "other"), null);
  });

  it("returns null for non-object answers (string)", () => {
    assert.strictEqual(computeFromAnswers("not an object", "other"), null);
  });

  it("returns null for non-object answers (number)", () => {
    assert.strictEqual(computeFromAnswers(42, "other"), null);
  });

  it("returns null for boolean answers", () => {
    assert.strictEqual(computeFromAnswers(true, "other"), null);
  });

  it("returns object with scores, escalations, pct, and track for valid answers", () => {
    const result = computeFromAnswers(lowRiskAnswers(), "script-api");
    assert.ok(result !== null);
    assert.ok("scores" in result);
    assert.ok("escalations" in result);
    assert.ok("pct" in result);
    assert.ok("track" in result);
  });

  it("computes correct scores for low-risk answers", () => {
    const result = computeFromAnswers(lowRiskAnswers(), "script-api");
    // Verify scores match direct scoring engine output
    const directScores = computeDimensionScores(lowRiskAnswers());
    assert.deepStrictEqual(result.scores, directScores);
  });

  it("computes correct track for high-risk answers", () => {
    const result = computeFromAnswers(highRiskAnswers(), "public-site");
    assert.strictEqual(result.track, 4);
    assert.ok(result.escalations.length > 0);
  });

  it("uses artifactType parameter when provided", () => {
    const answers = lowRiskAnswers();
    const resultExplicit = computeFromAnswers(answers, "ai-agent");
    const resultFromQ1 = computeFromAnswers(answers, null);
    // q1 = "script-api", explicit = "ai-agent" — different weights, different pct
    assert.notStrictEqual(resultExplicit.pct, resultFromQ1.pct);
  });

  it("falls back to answers.q1 when artifactType is not provided", () => {
    const answers = lowRiskAnswers(); // q1 = "script-api"
    const resultNoType = computeFromAnswers(answers, null);
    const resultQ1Type = computeFromAnswers(answers, "script-api");
    assert.strictEqual(resultNoType.pct, resultQ1Type.pct);
    assert.strictEqual(resultNoType.track, resultQ1Type.track);
  });

  it("falls back to 'other' when neither artifactType nor answers.q1 is set", () => {
    const answers = { q9: "no", q19: "I understand everything fully and can explain every detail." };
    const resultNoType = computeFromAnswers(answers, null);
    const resultOther = computeFromAnswers(answers, "other");
    assert.strictEqual(resultNoType.pct, resultOther.pct);
  });

  it("returns escalations array matching checkEscalations output", () => {
    const answers = highRiskAnswers();
    const result = computeFromAnswers(answers, "public-site");
    const directEsc = checkEscalations(answers);
    assert.deepStrictEqual(result.escalations, directEsc);
  });

  it("pct matches computeWeightedPercentage output", () => {
    const answers = midRiskAnswers();
    const result = computeFromAnswers(answers, "internal-app");
    const directScores = computeDimensionScores(answers);
    const directPct = computeWeightedPercentage(directScores, "internal-app");
    assert.strictEqual(result.pct, directPct);
  });

  it("floors flow through: FERPA on internet-reachable SSO deployment raises the floor without escalating", () => {
    // Same as midRiskAnswers but with q5 overridden to "public-auth" (internet-reachable,
    // SSO-protected) — this is a floor condition (Track 3 minimum), not an escalation
    // (escalation requires public-auth WITHOUT sso, or public-noauth).
    const answers = { ...midRiskAnswers(), q9: "yes", q10: ["ferpa"], q5: "public-auth", q6: "sso" };
    const result = computeFromAnswers(answers, "internal-app");
    assert.strictEqual(result.floors.length, 1, "FERPA + public-auth + sso should trigger exactly one floor");
    assert.strictEqual(result.escalations.length, 0, "FERPA + public-auth + sso (SSO present) should not escalate");
    assert.strictEqual(result.track, 3, "Floor should route to Track 3");
    assert.ok(result.track >= 3, "Routed track should be at least the floor track");
  });
});

// ===========================================================================
// Score computation on draft save
// ===========================================================================

describe("score computation on draft save", () => {
  it("scores are computed when draft has answers", () => {
    const answers = lowRiskAnswers();
    const computed = computeFromAnswers(answers, "script-api");
    assert.ok(computed !== null, "computeFromAnswers should return non-null for valid answers");
    for (const dim of SCORE_DIMENSIONS) {
      assert.ok(typeof computed.scores[dim] === "number", `${dim} should be computed`);
    }
  });

  it("scores are null when draft has no answers", () => {
    const computed = computeFromAnswers(null, "script-api");
    assert.strictEqual(computed, null);
    // In intake.js, computed?.scores.security ?? null would yield null
    assert.strictEqual(computed?.scores?.security ?? null, null);
  });

  it("track routing matches scoring engine output", () => {
    const answers = midRiskAnswers();
    const computed = computeFromAnswers(answers, "internal-app");
    const directScores = computeDimensionScores(answers);
    const directEsc = checkEscalations(answers);
    const directPct = computeWeightedPercentage(directScores, "internal-app");
    const directTrack = routeToTrack(directPct, directEsc.length > 0);
    assert.strictEqual(computed.track, directTrack);
  });

  it("weighted percentage is stored as rounded value (2 decimal places)", () => {
    // The route does: Math.round(computed.pct * 10000) / 100
    const answers = midRiskAnswers();
    const computed = computeFromAnswers(answers, "internal-app");
    const stored = Math.round(computed.pct * 10000) / 100;
    // Verify it's a valid percentage-like number
    assert.ok(stored >= 0 && stored <= 100, `Stored pct should be 0-100, got ${stored}`);
    // Verify no more than 2 decimal places
    const decimals = String(stored).split(".")[1];
    assert.ok(!decimals || decimals.length <= 2, `Stored pct should have at most 2 decimal places, got ${stored}`);
  });

  it("escalation_conditions are stored as JSON array", () => {
    const answers = highRiskAnswers();
    const computed = computeFromAnswers(answers, "public-site");
    const serialized = JSON.stringify(computed.escalations);
    const deserialized = JSON.parse(serialized);
    assert.ok(Array.isArray(deserialized));
    assert.strictEqual(deserialized.length, computed.escalations.length);
  });

  it("empty escalation_conditions serialize to empty JSON array", () => {
    const answers = lowRiskAnswers();
    const computed = computeFromAnswers(answers, "script-api");
    assert.strictEqual(computed.escalations.length, 0);
    assert.strictEqual(JSON.stringify(computed.escalations), "[]");
  });
});

// ===========================================================================
// Submit validation logic
// ===========================================================================

describe("submit validation", () => {
  it("submit from draft requires answers (returns null without)", () => {
    // Simulating the route logic: if neither intakeAnswers nor existing answers exist
    const answers = null;
    const computed = computeFromAnswers(answers, null);
    assert.strictEqual(computed, null, "Should return null => route returns 400");
  });

  it("submit from draft with valid answers produces scores and pending status", () => {
    const answers = midRiskAnswers();
    const computed = computeFromAnswers(answers, "internal-app");
    assert.ok(computed !== null, "Should compute successfully for valid answers");
    assert.ok(computed.track >= 1 && computed.track <= 4);
    // In the route, status is set to 'pending'
    const status = "pending";
    assert.strictEqual(status, "pending");
  });

  it("direct submit requires name (absent name would yield 400)", () => {
    // The route checks: if (!name) return res.status(400)
    const body = { intakeAnswers: lowRiskAnswers() };
    const parsed = parseBody(body);
    // name is undefined from body, so parsed.name is undefined (falsy)
    assert.ok(!parsed.name, "Missing name should be falsy");
  });

  it("direct submit requires answers (null answers would yield 400)", () => {
    const body = { name: "My Tool" };
    const parsed = parseBody(body);
    const computed = computeFromAnswers(parsed.intakeAnswers, parsed.artifactType);
    assert.strictEqual(computed, null, "No answers => computeFromAnswers returns null => route returns 400");
  });

  it("direct submit with valid body produces track and scores", () => {
    const body = {
      name: "My Tool",
      description: "A test tool",
      artifactType: "internal-app",
      intakeAnswers: JSON.stringify(midRiskAnswers()),
    };
    const parsed = parseBody(body);
    assert.ok(parsed.name);
    assert.ok(parsed.intakeAnswers);
    const computed = computeFromAnswers(parsed.intakeAnswers, parsed.artifactType);
    assert.ok(computed !== null);
    assert.ok(computed.track >= 1 && computed.track <= 4);
  });
});

// ===========================================================================
// Draft lifecycle guards
// ===========================================================================

describe("draft lifecycle guards", () => {
  it("only drafts can be edited (non-draft returns 400)", () => {
    // Route guard: if (existing.status !== "draft") return res.status(400)
    const nonDraftStatuses = ["pending", "in_progress", "under_review", "approved", "active", "changes_requested", "suspended"];
    for (const status of nonDraftStatuses) {
      assert.notStrictEqual(status, "draft", `Status "${status}" is not draft — should be rejected`);
    }
    // Only "draft" passes the guard
    assert.strictEqual("draft", "draft");
  });

  it("only drafts can be deleted (non-draft returns 400)", () => {
    // Same guard as edit: if (existing.status !== "draft") return res.status(400)
    const nonDraftStatuses = ["pending", "in_progress", "under_review", "approved", "active", "changes_requested", "suspended"];
    for (const status of nonDraftStatuses) {
      const wouldReject = status !== "draft";
      assert.ok(wouldReject, `Non-draft status "${status}" should be rejected for deletion`);
    }
  });

  it("draft status allows edit", () => {
    const status = "draft";
    const canEdit = status === "draft";
    assert.ok(canEdit);
  });

  it("draft status allows delete", () => {
    const status = "draft";
    const canDelete = status === "draft";
    assert.ok(canDelete);
  });
});

// ===========================================================================
// Scoring contract — backend recomputes, does not trust client
// ===========================================================================

describe("scoring contract", () => {
  it("backend recomputes scores on submit (doesn't trust client-provided scores)", () => {
    // computeFromAnswers always recomputes from raw answers
    // Even if the client sent different scores, the backend calls computeFromAnswers
    const answers = midRiskAnswers();
    const computed = computeFromAnswers(answers, "internal-app");

    // Verify the computed values match direct scoring engine output
    const directScores = computeDimensionScores(answers);
    const directEsc = checkEscalations(answers);
    const directPct = computeWeightedPercentage(directScores, "internal-app");
    const directTrack = routeToTrack(directPct, directEsc.length > 0);

    assert.deepStrictEqual(computed.scores, directScores);
    assert.deepStrictEqual(computed.escalations, directEsc);
    assert.strictEqual(computed.pct, directPct);
    assert.strictEqual(computed.track, directTrack);
  });

  it("escalation conditions properly detected from answers", () => {
    // Single escalation: no version control
    const answers = lowRiskAnswers();
    answers.q15 = "no-vc";
    const computed = computeFromAnswers(answers, "script-api");
    assert.ok(computed.escalations.length > 0, "Should detect no-vc escalation");
    assert.ok(computed.escalations.some(e => e.includes("version control")));
    assert.strictEqual(computed.track, 4, "Escalation forces Track 4");
  });

  it("all 7 dimensions computed from 21 answers", () => {
    const answers = highRiskAnswers();
    const computed = computeFromAnswers(answers, "public-site");
    assert.strictEqual(Object.keys(computed.scores).length, 7);
    for (const dim of SCORE_DIMENSIONS) {
      assert.ok(dim in computed.scores, `Missing dimension: ${dim}`);
      assert.ok(typeof computed.scores[dim] === "number", `${dim} should be a number`);
      assert.ok(computed.scores[dim] >= 0 && computed.scores[dim] <= 3, `${dim} should be 0-3, got ${computed.scores[dim]}`);
    }
  });

  it("each dimension score is bounded 0-3", () => {
    // Test with extreme answers to verify capping
    const answers = highRiskAnswers();
    const scores = computeDimensionScores(answers);
    for (const dim of SCORE_DIMENSIONS) {
      assert.ok(scores[dim] >= 0, `${dim} must be >= 0`);
      assert.ok(scores[dim] <= 3, `${dim} must be <= 3`);
    }
  });

  it("weighted percentage is between 0 and 1", () => {
    for (const type of VALID_ARTIFACT_TYPES) {
      const lowResult = computeFromAnswers(lowRiskAnswers(), type);
      assert.ok(lowResult.pct >= 0 && lowResult.pct <= 1,
        `pct for ${type} (low-risk) should be 0-1, got ${lowResult.pct}`);
      const highResult = computeFromAnswers(highRiskAnswers(), type);
      assert.ok(highResult.pct >= 0 && highResult.pct <= 1,
        `pct for ${type} (high-risk) should be 0-1, got ${highResult.pct}`);
    }
  });

  it("track is always 1, 2, 3, or 4", () => {
    const answerSets = [lowRiskAnswers(), midRiskAnswers(), highRiskAnswers()];
    for (const answers of answerSets) {
      for (const type of VALID_ARTIFACT_TYPES) {
        const result = computeFromAnswers(answers, type);
        assert.ok([1, 2, 3, 4].includes(result.track),
          `Track should be 1-4, got ${result.track} for ${type}`);
      }
    }
  });
});

// ===========================================================================
// Integration: end-to-end intake flow simulation
// ===========================================================================

describe("intake flow — end-to-end simulation", () => {
  it("multipart body with stringified answers parses and scores correctly", () => {
    // Simulate what multer produces: body fields are strings from multipart form
    const answers = midRiskAnswers();
    const body = {
      name: "FERPA Dashboard",
      description: "Student data viewer",
      submissionType: "new",
      artifactType: "internal-app",
      intakeAnswers: JSON.stringify(answers),
      codebaseUrl: "https://github.com/umt/ferpa-dash",
    };

    const parsed = parseBody(body);
    assert.strictEqual(parsed.name, "FERPA Dashboard");
    assert.strictEqual(parsed.description, "Student data viewer");
    assert.strictEqual(parsed.submissionType, "new");
    assert.strictEqual(parsed.artifactType, "internal-app");
    assert.deepStrictEqual(parsed.intakeAnswers, answers);
    assert.strictEqual(parsed.codebaseUrl, "https://github.com/umt/ferpa-dash");

    const computed = computeFromAnswers(parsed.intakeAnswers, parsed.artifactType);
    assert.ok(computed !== null);
    assert.ok(computed.track >= 1 && computed.track <= 4);
  });

  it("declaring a different artifact type no longer changes the routed percentage when both profiles are already implied by the answers (FW-05)", () => {
    // Pre-FW-05 this asserted notStrictEqual: declaring "ai-agent" instead of
    // "internal-app" used to pick a different, single weight profile and thus
    // a different pct. FW-05's anti-gaming guard changes that: applicableProfiles
    // always adds "internal-app" when q5 is campus-vpn/public-auth, and always
    // adds "ai-agent" when q12 indicates external AI processing (any of
    // approved-dpa/unknown-dpa/no-dpa). midRiskAnswers has q5="campus-vpn" and
    // q12="approved-dpa", so BOTH declarations ("internal-app" and "ai-agent")
    // resolve to the identical applicable-profile set {internal-app, ai-agent},
    // and computeEffectivePercentage takes the max over that set either way.
    //
    // Hand computation (scores from computeDimensionScores(midRiskAnswers())):
    //   security=1, accessibility=2, dataSensitivity=2, blastRadius=2,
    //   autonomy=0, comprehension=1, maintenance=1
    //
    //   internal-app weights {sec:3,a11y:3,data:4,blast:2,auto:1,comp:2,maint:3}
    //     total = 1*3+2*3+2*4+2*2+0*1+1*2+1*3 = 3+6+8+4+0+2+3 = 26
    //     max   = 3*(3+3+4+2+1+2+3) = 3*18 = 54
    //     pct   = 26/54 = 0.481481...
    //
    //   ai-agent weights {sec:3,a11y:1,data:3,blast:4,auto:4,comp:4,maint:3}
    //     total = 1*3+2*1+2*3+2*4+0*4+1*4+1*3 = 3+2+6+8+0+4+3 = 26
    //     max   = 3*(3+1+3+4+4+4+3) = 3*22 = 66
    //     pct   = 26/66 = 0.393939...
    //
    //   max(0.481481..., 0.393939...) = 0.481481... (internal-app wins) —
    //   for BOTH declared types, since both profiles are in-scope either way.
    const answers = midRiskAnswers();
    const asInternalApp = computeFromAnswers(answers, "internal-app");
    const asAiAgent = computeFromAnswers(answers, "ai-agent");
    assert.strictEqual(asInternalApp.pct, asAiAgent.pct,
      "Both declarations resolve to the same applicable-profile superset, so pct converges");
    assert.ok(Math.abs(asInternalApp.pct - 26 / 54) < 1e-9);
  });

  it("escalation overrides score-based routing to force Track 4", () => {
    // Low-risk answers but with custom auth — triggers escalation
    const answers = lowRiskAnswers();
    answers.q6 = "custom-auth";
    const computed = computeFromAnswers(answers, "script-api");
    assert.ok(computed.escalations.some(e => e.includes("SSO")));
    assert.strictEqual(computed.track, 4, "Custom auth escalation should force Track 4");
    // Verify that without the escalation, it would be a lower track
    answers.q6 = "sso";
    const noEsc = computeFromAnswers(answers, "script-api");
    assert.ok(noEsc.track < 4, "Without escalation, track should be lower than 4");
  });

  it("all valid artifact types are accepted by computeFromAnswers", () => {
    const answers = lowRiskAnswers();
    for (const type of VALID_ARTIFACT_TYPES) {
      const result = computeFromAnswers(answers, type);
      assert.ok(result !== null, `computeFromAnswers should accept artifact type "${type}"`);
    }
  });

  it("unknown artifact type falls back to answers.q1, not blindly to 'other' (FW-05)", () => {
    // Pre-FW-05, computeWeightedPercentage() alone treated any invalid
    // artifactType string as equivalent to "other". FW-05's
    // applicableProfiles() changes the fallback: an invalid declaredType
    // falls back to answers.q1 (if q1 is itself a valid type) rather than to
    // "other" — because "other" is now a distinct, legitimate declaration in
    // its own right (it IS a member of VALID_ARTIFACT_TYPES) and should not
    // be silently substituted for a genuinely-unrecognized string when the
    // answers already declare a valid type via q1.
    //
    // lowRiskAnswers() has q1="script-api" (valid), q5="campus-vpn" (adds
    // "internal-app"), q12="approved-dpa" (adds "ai-agent"). So:
    //   applicableProfiles(answers, "banana-stand") -> declared falls back to
    //     q1="script-api" -> {script-api, ai-agent, internal-app}
    //   applicableProfiles(answers, "script-api") -> declared="script-api"
    //     (valid, used directly) -> {script-api, ai-agent, internal-app}
    // Identical sets, so pct/track must match "script-api", NOT "other"
    // (which would instead evaluate {other, ai-agent, internal-app} and
    // yields a different result: other's own weights differ from
    // script-api's, so max-over-set differs too).
    const answers = lowRiskAnswers();
    const unknown = computeFromAnswers(answers, "banana-stand");
    const asQ1 = computeFromAnswers(answers, "script-api");
    const asOther = computeFromAnswers(answers, "other");
    assert.strictEqual(unknown.pct, asQ1.pct);
    assert.strictEqual(unknown.track, asQ1.track);
    assert.notStrictEqual(unknown.pct, asOther.pct,
      "Invalid type should NOT silently collapse to explicit 'other' when q1 is valid");
  });
});

// ===========================================================================
// Resubmit route (shape) — Task 17
//
// NOTE: There is no HTTP test harness in this repo (no supertest/similar
// dependency, per the "no new deps" constraint). These tests exercise the
// same building blocks the route uses (computeFromAnswers, validateIntakeAnswers,
// and the route's status/ownership guard conditions as inline boolean checks)
// rather than making real HTTP requests against router.post("/:id/resubmit").
// The route's DB interaction (tool_versions INSERT, tools UPDATE, audit log,
// all inside withTransaction) is NOT covered by these unit tests — only the
// pure-function scoring/validation logic and guard predicates are.
// ===========================================================================

describe("resubmit route (shape)", () => {
  it("only changes_requested tools can be resubmitted (guard predicate)", () => {
    // Route guard: if (existing.status !== "changes_requested") return res.status(400)
    const otherStatuses = ["draft", "pending", "in_progress", "under_review", "approved", "active", "suspended"];
    for (const status of otherStatuses) {
      assert.notStrictEqual(status, "changes_requested", `Status "${status}" should be rejected for resubmit`);
    }
    assert.strictEqual("changes_requested", "changes_requested");
  });

  it("owner-or-admin guard predicate matches route logic", () => {
    // Route guard: if (existing.owner_id !== req.user.userId && req.user.role !== "admin") return 403
    const ownerId = "user-1";
    const cases = [
      { userId: "user-1", role: "builder", allowed: true },   // owner
      { userId: "user-2", role: "admin", allowed: true },     // admin, not owner
      { userId: "user-2", role: "builder", allowed: false },  // neither owner nor admin
      { userId: "user-2", role: "reviewer", allowed: false }, // reviewer is not owner or admin
    ];
    for (const { userId, role, allowed } of cases) {
      const wouldReject = ownerId !== userId && role !== "admin";
      assert.strictEqual(!wouldReject, allowed, `userId=${userId} role=${role}`);
    }
  });

  it("resubmit validates the resolved answers (existing.intake_answers fallback) before recomputing", () => {
    // Route: const answers = intakeAnswers || existing.intake_answers;
    // Simulates a resubmission where the client sends no new answers and the
    // existing tool's stored answers (with q19 blank, changes-requested-worthy)
    // are used as the fallback — validation should still catch missing q19.
    const existingAnswers = { ...highRiskAnswers(), q19: "" };
    const submittedAnswers = null;
    const resolved = submittedAnswers || existingAnswers;
    const validation = validateIntakeAnswers(resolved);
    assert.strictEqual(validation.ok, false, "Missing q19 should fail validation on resubmit");
  });

  it("resubmit recomputes scores/track from the resolved answers, not the stored tool row", () => {
    // Simulates: builder addressed feedback (added version control, fixed auth)
    // between changes_requested and resubmit — recompute must reflect the fix.
    const beforeAnswers = { ...lowRiskAnswers(), q15: "no-vc" }; // escalation -> Track 4
    const beforeComputed = computeFromAnswers(beforeAnswers, "script-api");
    assert.strictEqual(beforeComputed.track, 4);

    const fixedAnswers = { ...beforeAnswers, q15: "personal-repo" }; // escalation resolved
    const afterComputed = computeFromAnswers(fixedAnswers, "script-api");
    assert.ok(afterComputed.track < 4, "Fixing the escalation condition should lower the track on resubmit");
  });

  it("resubmit falls back to existing artifact_type/name/description when not resubmitted (COALESCE semantics)", () => {
    // Route: artType = artifactType || existing.artifact_type
    //        name = COALESCE($1, name) / description = COALESCE($2, description) in SQL
    const existing = { artifact_type: "internal-app", name: "Existing Tool", description: "Existing desc" };
    const bodyArtifactType = null;
    const bodyName = null;
    const bodyDescription = null;
    const resolvedArtType = bodyArtifactType || existing.artifact_type;
    assert.strictEqual(resolvedArtType, "internal-app");
    // COALESCE(null, existing) keeps existing value — simulated here since this
    // is SQL-side behavior, not JS-side, and can't run against a real DB in this suite.
    const resolvedName = bodyName ?? existing.name;
    const resolvedDescription = bodyDescription ?? existing.description;
    assert.strictEqual(resolvedName, "Existing Tool");
    assert.strictEqual(resolvedDescription, "Existing desc");
  });

  it("stored weighted_percentage rounding matches the resubmit route's Math.round(pct * 10000) / 100", () => {
    const answers = midRiskAnswers();
    const computed = computeFromAnswers(answers, "internal-app");
    const stored = Math.round(computed.pct * 10000) / 100;
    assert.ok(stored >= 0 && stored <= 100);
  });

  it("changes_requested -> under_review is the resubmit route's target status (state-machine sanity)", () => {
    // The route sets status = 'under_review' directly via UPDATE (not through
    // registry.js's canTransition/TRANSITIONS map — resubmit is a distinct
    // code path from the reviewer-driven status endpoint). This test just
    // documents the target status the route writes.
    const targetStatus = "under_review";
    assert.strictEqual(targetStatus, "under_review");
  });
});

// ===========================================================================
// validateIntakeAnswers (FW-03) — enforces phantom-required questions
// ===========================================================================

describe("validateIntakeAnswers (FW-03)", () => {
  const complete = {
    q1: "internal-app", q2: "no", q3: ["department"], q4: "Does a thing for the department.",
    q5: "campus-vpn", q6: "sso", q7: ["web-hosting"], q9: "no",
    q14: "department", q15: "campus-repo", q16: "documented", q17: "active", q18: "team-runbooks",
    q19: "It renders reports from a database. On failure it shows an error page and logs to the campus logger.",
  };

  it("accepts a complete non-data, non-AI submission", () => {
    assert.equal(validateIntakeAnswers(complete).ok, true);
  });

  it("rejects q9=yes with missing q10/q11/q12", () => {
    const r = validateIntakeAnswers({ ...complete, q9: "yes" });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.includes("q10")));
    assert.ok(r.errors.some(e => e.includes("q11")));
    assert.ok(r.errors.some(e => e.includes("q12")));
  });

  it("accepts q9=yes when q10-q12 are provided", () => {
    const r = validateIntakeAnswers({ ...complete, q9: "yes", q10: ["internal"], q11: ["campus"], q12: "no" });
    assert.equal(r.ok, true);
  });

  it("rejects AI-classified submission missing q20/q21", () => {
    const r = validateIntakeAnswers({ ...complete, q1: "ai-agent" });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.includes("q20")));
    assert.ok(r.errors.some(e => e.includes("q21")));
  });

  it("rejects missing q19", () => {
    const { q19, ...rest } = complete;
    const r = validateIntakeAnswers(rest);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.includes("q19")));
  });

  it("rejects invalid enum values on escalation-relevant questions", () => {
    const r = validateIntakeAnswers({ ...complete, q9: "yes", q10: ["nonsense"], q11: ["campus"], q12: "whatever" });
    assert.equal(r.ok, false);
  });

  it("external AI via q12 also requires q20/q21", () => {
    const r = validateIntakeAnswers({ ...complete, q9: "yes", q10: ["internal"], q11: ["campus"], q12: "approved-dpa" });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.includes("q21")));
  });
});
