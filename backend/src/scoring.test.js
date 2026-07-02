import { describe, it } from "node:test";
import assert from "node:assert";

import {
  WEIGHT_PROFILES,
  SCORE_DIMENSIONS,
  computeDimensionScores,
  computeWeightedPercentage,
  routeToTrack,
  checkEscalations,
  checkFloors,
  computeTrack,
  VALID_ARTIFACT_TYPES,
  applicableProfiles,
  computeEffectivePercentage,
} from "./scoring.js";

// Import frontend weight matrix for cross-check
import { WEIGHT_MATRIX, computeTrack as feComputeTrack } from "../../frontend/src/constants.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Baseline "benign" answers — low risk across the board. */
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

/** High-risk answers that should push scores up. */
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

// ===========================================================================
// computeDimensionScores
// ===========================================================================

describe("computeDimensionScores", () => {
  it("returns all seven dimensions", () => {
    const scores = computeDimensionScores({});
    for (const dim of SCORE_DIMENSIONS) {
      assert.ok(dim in scores, `Missing dimension: ${dim}`);
    }
  });

  it("returns all zeros for empty / minimal answers", () => {
    const scores = computeDimensionScores({ q9: "no" });
    // q9=no forces dataSensitivity=0; everything else should default 0
    // except comprehension — empty q19 means comprehension=3
    assert.strictEqual(scores.security, 0);
    assert.strictEqual(scores.accessibility, 0);
    assert.strictEqual(scores.dataSensitivity, 0);
    assert.strictEqual(scores.blastRadius, 0);
    assert.strictEqual(scores.autonomy, 0);
    assert.strictEqual(scores.comprehension, 3); // empty q19 -> 3
    assert.strictEqual(scores.maintenance, 0);
  });

  it("scores security correctly for public-noauth", () => {
    const scores = computeDimensionScores({ q5: "public-noauth", q6: "sso" });
    assert.strictEqual(scores.security, 3);
  });

  it("scores security correctly for public-auth", () => {
    const scores = computeDimensionScores({ q5: "public-auth", q6: "sso" });
    assert.strictEqual(scores.security, 2);
  });

  it("adds 1 to security for no-auth or custom-auth (capped at 3)", () => {
    // campus-vpn gives security=1, + no-auth gives 2
    const s1 = computeDimensionScores({ q5: "campus-vpn", q6: "no-auth" });
    assert.strictEqual(s1.security, 2);

    // public-noauth gives security=3, + custom-auth stays capped at 3
    const s2 = computeDimensionScores({ q5: "public-noauth", q6: "custom-auth" });
    assert.strictEqual(s2.security, 3);
  });

  it("scores accessibility for public-facing and internal-app", () => {
    const pub = computeDimensionScores({ q5: "public-noauth" });
    assert.strictEqual(pub.accessibility, 3);

    const pubAuth = computeDimensionScores({ q5: "public-auth" });
    assert.strictEqual(pubAuth.accessibility, 3);

    const internal = computeDimensionScores({ q1: "internal-app", q5: "campus-vpn" });
    assert.strictEqual(internal.accessibility, 2);

    const other = computeDimensionScores({ q1: "script-api", q5: "campus-vpn" });
    assert.strictEqual(other.accessibility, 0);
  });

  it("scores dataSensitivity correctly across tiers", () => {
    // HIPAA -> 3
    const hipaa = computeDimensionScores({ q9: "yes", q10: ["hipaa"] });
    assert.strictEqual(hipaa.dataSensitivity, 3);

    // FERPA -> 2
    const ferpa = computeDimensionScores({ q9: "yes", q10: ["ferpa"] });
    assert.strictEqual(ferpa.dataSensitivity, 2);

    // internal -> 1
    const internal = computeDimensionScores({ q9: "yes", q10: ["internal"] });
    assert.strictEqual(internal.dataSensitivity, 1);

    // q9=no overrides everything to 0
    const noData = computeDimensionScores({ q9: "no", q10: ["hipaa"] });
    assert.strictEqual(noData.dataSensitivity, 0);
  });

  it("scores blastRadius with user groups and user count", () => {
    const pub = computeDimensionScores({ q3: ["public"] });
    assert.strictEqual(pub.blastRadius, 3);

    const students = computeDimensionScores({ q3: ["students"] });
    assert.strictEqual(students.blastRadius, 2);

    const team = computeDimensionScores({ q3: ["team"] });
    assert.strictEqual(team.blastRadius, 1);

    // 500+ adds 1, capped at 3
    const teamLarge = computeDimensionScores({ q3: ["team"], q8: "500+" });
    assert.strictEqual(teamLarge.blastRadius, 2);

    const pubLarge = computeDimensionScores({ q3: ["public"], q8: "500+" });
    assert.strictEqual(pubLarge.blastRadius, 3); // capped
  });

  it("scores autonomy based on q21 and legacy free-text q20 (improvement 17 rules)", () => {
    // q20 undefined -> not in AUTONOMY_LEVELS ("undefined" key absent) -> legacy
    // branch: a.q20 is falsy -> auto=0. q21=no -> +1 (was +2 pre-improvement-17).
    const noDisclosure = computeDimensionScores({ q21: "no" });
    assert.strictEqual(noDisclosure.autonomy, 1);

    // q21=partial no longer contributes (disclosure is one signal, not the
    // dimension) -> auto stays 0.
    const partial = computeDimensionScores({ q21: "partial" });
    assert.strictEqual(partial.autonomy, 0);

    // q20 free text, not an AUTONOMY_LEVELS key -> legacy length heuristic:
    // "Makes decisions autonomously".length > 10 -> auto=1. q21=no -> +1 = 2
    // (was 3 pre-improvement-17, since q21=no used to add +2).
    const withDesc = computeDimensionScores({ q21: "no", q20: "Makes decisions autonomously" });
    assert.strictEqual(withDesc.autonomy, 2);

    // q21=yes, empty q20 -> legacy branch, falsy -> 0. Unchanged.
    const fullyDisclosed = computeDimensionScores({ q21: "yes", q20: "" });
    assert.strictEqual(fullyDisclosed.autonomy, 0);
  });

  it("scores comprehension based on q19 length", () => {
    const empty = computeDimensionScores({ q19: "" });
    assert.strictEqual(empty.comprehension, 3);

    const veryShort = computeDimensionScores({ q19: "I know it." }); // <20
    assert.strictEqual(veryShort.comprehension, 3);

    const short = computeDimensionScores({ q19: "I understand the basics of the code but there are some AI parts." }); // 20-79 chars
    assert.strictEqual(short.comprehension, 2);

    const medium = computeDimensionScores({
      q19: "I have a thorough understanding of the code. I can explain each function, the data flow, the API integration patterns, and the AI model's role. I reviewed all generated code carefully and tested each component.",
    }); // >=200 chars
    assert.strictEqual(medium.comprehension, 0);
  });

  it("scores maintenance based on version control, ownership, deps, team", () => {
    // no-vc (+1) + nobody (+1) + third-party-dep (+0.5) + only-me (+0.5) = 3
    const worst = computeDimensionScores({
      q15: "no-vc", q16: "nobody", q17: "third-party-dep", q18: "only-me",
    });
    assert.strictEqual(worst.maintenance, 3);

    // personal-repo + documented + occasional + team-runbooks = 0
    const best = computeDimensionScores({
      q15: "personal-repo", q16: "documented", q17: "occasional", q18: "team-runbooks",
    });
    assert.strictEqual(best.maintenance, 0);

    // no-vc (+1) + stop (+1) = 2
    const mid = computeDimensionScores({
      q15: "no-vc", q16: "stop", q17: "occasional", q18: "team-runbooks",
    });
    assert.strictEqual(mid.maintenance, 2);
  });

  it("produces high scores for high-risk answers", () => {
    const scores = computeDimensionScores(highRiskAnswers());
    assert.strictEqual(scores.security, 3);
    assert.strictEqual(scores.accessibility, 3);
    assert.strictEqual(scores.dataSensitivity, 3);
    assert.strictEqual(scores.blastRadius, 3);
    // highRiskAnswers().q20 is legacy free text ("AI makes autonomous
    // decisions about student grading without oversight"), not an
    // AUTONOMY_LEVELS key -> legacy length heuristic: length > 10 -> auto=1.
    // q21="no" -> +1 = 2 (was 3 pre-improvement-17, since q21=no used to add
    // +2 and the length heuristic alone hit the +1 cap headroom).
    assert.strictEqual(scores.autonomy, 2);
    assert.strictEqual(scores.comprehension, 3);
    assert.strictEqual(scores.maintenance, 3);
  });
});

// ===========================================================================
// computeWeightedPercentage
// ===========================================================================

describe("computeWeightedPercentage", () => {
  it("returns 0 for all-zero scores", () => {
    const zeros = { security: 0, accessibility: 0, dataSensitivity: 0, blastRadius: 0, autonomy: 0, comprehension: 0, maintenance: 0 };
    const pct = computeWeightedPercentage(zeros, "public-site");
    assert.strictEqual(pct, 0);
  });

  it("returns 1.0 for all-three scores", () => {
    const threes = { security: 3, accessibility: 3, dataSensitivity: 3, blastRadius: 3, autonomy: 3, comprehension: 3, maintenance: 3 };
    const pct = computeWeightedPercentage(threes, "public-site");
    assert.ok(Math.abs(pct - 1.0) < 1e-10, `Expected 1.0, got ${pct}`);
  });

  it("handles unknown artifact type by falling back to 'other'", () => {
    const scores = { security: 1, accessibility: 1, dataSensitivity: 1, blastRadius: 1, autonomy: 1, comprehension: 1, maintenance: 1 };
    const pctUnknown = computeWeightedPercentage(scores, "banana");
    const pctOther = computeWeightedPercentage(scores, "other");
    assert.strictEqual(pctUnknown, pctOther);
  });

  it("computes correct weighted percentage for a known case", () => {
    // public-site weights: security:4, accessibility:4, dataSensitivity:3, blastRadius:3, autonomy:1, comprehension:2, maintenance:3
    // max = 3*(4+4+3+3+1+2+3) = 3*20 = 60
    // scores: security=2, rest=0 => total = 2*4 = 8
    const scores = { security: 2, accessibility: 0, dataSensitivity: 0, blastRadius: 0, autonomy: 0, comprehension: 0, maintenance: 0 };
    const pct = computeWeightedPercentage(scores, "public-site");
    assert.ok(Math.abs(pct - 8 / 60) < 1e-10, `Expected ${8 / 60}, got ${pct}`);
  });

  it("respects zero-weight dimensions (script-api accessibility=0)", () => {
    // script-api: accessibility weight = 0, so accessibility score shouldn't matter
    const a = { security: 0, accessibility: 3, dataSensitivity: 0, blastRadius: 0, autonomy: 0, comprehension: 0, maintenance: 0 };
    const b = { security: 0, accessibility: 0, dataSensitivity: 0, blastRadius: 0, autonomy: 0, comprehension: 0, maintenance: 0 };
    assert.strictEqual(
      computeWeightedPercentage(a, "script-api"),
      computeWeightedPercentage(b, "script-api"),
    );
  });
});

// ===========================================================================
// routeToTrack — boundary conditions
// ===========================================================================

describe("routeToTrack", () => {
  it("routes < 22% to Track 1", () => {
    assert.strictEqual(routeToTrack(0, false), 1);
    assert.strictEqual(routeToTrack(0.10, false), 1);
    assert.strictEqual(routeToTrack(0.2199, false), 1);
  });

  it("routes exactly 22% to Track 2", () => {
    assert.strictEqual(routeToTrack(0.22, false), 2);
  });

  it("routes 22%-41.99% to Track 2", () => {
    assert.strictEqual(routeToTrack(0.30, false), 2);
    assert.strictEqual(routeToTrack(0.4199, false), 2);
  });

  it("routes exactly 42% to Track 3", () => {
    assert.strictEqual(routeToTrack(0.42, false), 3);
  });

  it("routes 42%-64.99% to Track 3", () => {
    assert.strictEqual(routeToTrack(0.50, false), 3);
    assert.strictEqual(routeToTrack(0.6499, false), 3);
  });

  it("routes exactly 65% to Track 4", () => {
    assert.strictEqual(routeToTrack(0.65, false), 4);
  });

  it("routes >= 65% to Track 4", () => {
    assert.strictEqual(routeToTrack(0.80, false), 4);
    assert.strictEqual(routeToTrack(1.0, false), 4);
  });

  it("forces Track 4 when hasEscalation is true regardless of percentage", () => {
    assert.strictEqual(routeToTrack(0, true), 4);
    assert.strictEqual(routeToTrack(0.10, true), 4);
    assert.strictEqual(routeToTrack(0.30, true), 4);
    assert.strictEqual(routeToTrack(0.50, true), 4);
  });
});

// ===========================================================================
// checkEscalations
// ===========================================================================

describe("checkEscalations", () => {
  it("returns empty array for low-risk answers", () => {
    const esc = checkEscalations(lowRiskAnswers());
    assert.strictEqual(esc.length, 0);
  });

  it("detects regulated data (HIPAA)", () => {
    const esc = checkEscalations({ q10: ["hipaa"] });
    assert.ok(esc.some(e => e.includes("Regulated data")));
  });

  it("detects regulated data (IRB)", () => {
    const esc = checkEscalations({ q10: ["irb"] });
    assert.ok(esc.some(e => e.includes("Regulated data")));
  });

  it("detects regulated data (Export controlled)", () => {
    const esc = checkEscalations({ q10: ["export"] });
    assert.ok(esc.some(e => e.includes("Regulated data")));
  });

  it("detects regulated data (Tribal)", () => {
    const esc = checkEscalations({ q10: ["tribal"] });
    assert.ok(esc.some(e => e.includes("Regulated data")));
  });

  it("detects FERPA + public-facing deployment (public-noauth)", () => {
    const esc = checkEscalations({ q10: ["ferpa"], q5: "public-noauth" });
    assert.ok(esc.some(e => e.includes("FERPA")));
  });

  it("detects FERPA + public-facing deployment (public-auth)", () => {
    const esc = checkEscalations({ q10: ["ferpa"], q5: "public-auth" });
    assert.ok(esc.some(e => e.includes("FERPA")));
  });

  it("does NOT flag FERPA on campus-vpn", () => {
    const esc = checkEscalations({ q10: ["ferpa"], q5: "campus-vpn" });
    assert.ok(!esc.some(e => e.includes("FERPA")));
  });

  it("detects institutional data in personal accounts", () => {
    const esc = checkEscalations({ q10: [], q11: ["personal"] });
    assert.ok(esc.some(e => e.includes("personal accounts")));
  });

  it("detects AI model without approved DPA (no-dpa)", () => {
    const esc = checkEscalations({ q10: [], q12: "no-dpa" });
    assert.ok(esc.some(e => e.includes("DPA")));
  });

  it("detects AI model without approved DPA (unknown-dpa)", () => {
    const esc = checkEscalations({ q10: [], q12: "unknown-dpa" });
    assert.ok(esc.some(e => e.includes("DPA")));
  });

  it("detects custom auth outside SSO", () => {
    const esc = checkEscalations({ q10: [], q6: "custom-auth" });
    assert.ok(esc.some(e => e.includes("SSO")));
  });

  it("detects no version control", () => {
    const esc = checkEscalations({ q10: [], q15: "no-vc" });
    assert.ok(esc.some(e => e.includes("version control")));
  });

  it("detects students unaware of AI", () => {
    const esc = checkEscalations({ q10: [], q21: "no", q3: ["students"] });
    assert.ok(esc.some(e => e.includes("Students unaware")));
  });

  it("does NOT flag students-unaware when q21=yes", () => {
    const esc = checkEscalations({ q10: [], q21: "yes", q3: ["students"] });
    assert.ok(!esc.some(e => e.includes("Students unaware")));
  });

  it("does NOT flag students-unaware when q3 has no students", () => {
    const esc = checkEscalations({ q10: [], q21: "no", q3: ["team"] });
    assert.ok(!esc.some(e => e.includes("Students unaware")));
  });

  it("returns the 7 originally-defined escalation conditions for maximum-risk answers (fixture does not trigger the payment/autonomy additions)", () => {
    const answers = {
      q3: ["students"],
      q5: "public-noauth",
      q6: "custom-auth",
      q10: ["hipaa", "ferpa"],
      q11: ["personal"],
      q12: "no-dpa",
      q15: "no-vc",
      q21: "no",
    };
    const esc = checkEscalations(answers);
    assert.strictEqual(esc.length, 7, `Expected 7 escalations, got ${esc.length}: ${JSON.stringify(esc)}`);
  });
});

// ===========================================================================
// FERPA escalation split + track floors (FW-06)
// ===========================================================================

describe("FERPA escalation split (FW-06)", () => {
  it("FERPA + public-noauth still escalates to Track 4", () => {
    const e = checkEscalations({ q9: "yes", q10: ["ferpa"], q5: "public-noauth" });
    assert.ok(e.includes("FERPA + public-facing deployment"));
  });

  it("FERPA + public-auth without SSO still escalates", () => {
    const e = checkEscalations({ q9: "yes", q10: ["ferpa"], q5: "public-auth", q6: "not-implemented" });
    assert.ok(e.includes("FERPA + public-facing deployment"));
  });

  it("FERPA + public-auth + SSO does NOT escalate", () => {
    const e = checkEscalations({ q9: "yes", q10: ["ferpa"], q5: "public-auth", q6: "sso" });
    assert.ok(!e.some(x => x.startsWith("FERPA")));
  });

  it("FERPA + public-auth + SSO floors at Track 3", () => {
    const f = checkFloors({ q9: "yes", q10: ["ferpa"], q5: "public-auth", q6: "sso" });
    assert.strictEqual(f.length, 1);
    assert.strictEqual(f[0].track, 3);
  });

  it("no floor without FERPA or without public-auth", () => {
    assert.strictEqual(checkFloors({ q9: "yes", q10: ["internal"], q5: "public-auth", q6: "sso" }).length, 0);
    assert.strictEqual(checkFloors({ q9: "yes", q10: ["ferpa"], q5: "campus-vpn", q6: "sso" }).length, 0);
  });
});

describe("routeToTrack floor", () => {
  it("floor raises a lower percentage track", () => {
    assert.strictEqual(routeToTrack(0.30, false, 3), 3);
  });
  it("floor never lowers a higher track", () => {
    assert.strictEqual(routeToTrack(0.70, false, 3), 4);
  });
  it("escalation still wins over floor", () => {
    assert.strictEqual(routeToTrack(0.10, true, 3), 4);
  });
  it("default floor is 1 (backward compatible)", () => {
    assert.strictEqual(routeToTrack(0.10, false), 1);
  });
});

// ===========================================================================
// computeTrack — integration
// ===========================================================================

describe("computeTrack", () => {
  it("returns all expected fields", () => {
    const result = computeTrack(lowRiskAnswers());
    assert.ok("track" in result);
    assert.ok("scores" in result);
    assert.ok("escalations" in result);
    assert.ok("weightedPct" in result);
  });

  it("routes low-risk answers to Track 1 or 2", () => {
    const result = computeTrack(lowRiskAnswers());
    assert.ok(result.track <= 2, `Expected Track 1 or 2, got Track ${result.track}`);
    assert.strictEqual(result.escalations.length, 0);
  });

  it("routes high-risk answers to Track 4", () => {
    const result = computeTrack(highRiskAnswers());
    assert.strictEqual(result.track, 4);
    assert.ok(result.escalations.length > 0);
  });

  it("forces Track 4 on escalation even if weighted % is low", () => {
    // Low scores but with no version control escalation
    const answers = lowRiskAnswers();
    answers.q15 = "no-vc";
    const result = computeTrack(answers);
    assert.strictEqual(result.track, 4, "Escalation (no-vc) should force Track 4");
    assert.ok(result.escalations.some(e => e.includes("version control")));
  });

  it("uses q1 as artifact type when no explicit type given", () => {
    const answers = lowRiskAnswers();
    answers.q1 = "ai-agent";
    const result = computeTrack(answers);
    // ai-agent has high autonomy/comprehension weights, so same scores yield different %
    const altAnswers = { ...answers, q1: "script-api" };
    const altResult = computeTrack(altAnswers);
    // The percentages should differ because weight profiles differ
    assert.notStrictEqual(result.weightedPct, altResult.weightedPct);
  });
});

// ===========================================================================
// Frontend / Backend weight matrix parity
// ===========================================================================

describe("weight matrix parity (frontend vs backend)", () => {
  it("frontend WEIGHT_MATRIX matches backend WEIGHT_PROFILES for all artifact types", () => {
    const backendTypes = Object.keys(WEIGHT_PROFILES).sort();
    const frontendTypes = Object.keys(WEIGHT_MATRIX).sort();
    assert.deepStrictEqual(backendTypes, frontendTypes, "Artifact types differ between frontend and backend");

    for (const type of backendTypes) {
      for (const dim of SCORE_DIMENSIONS) {
        assert.strictEqual(
          WEIGHT_PROFILES[type][dim],
          WEIGHT_MATRIX[type][dim],
          `Mismatch: ${type}.${dim} — backend=${WEIGHT_PROFILES[type][dim]}, frontend=${WEIGHT_MATRIX[type][dim]}`,
        );
      }
    }
  });

  it("VALID_ARTIFACT_TYPES matches WEIGHT_PROFILES keys", () => {
    assert.deepStrictEqual(VALID_ARTIFACT_TYPES.sort(), Object.keys(WEIGHT_PROFILES).sort());
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================

describe("edge cases", () => {
  it("handles completely empty answer object", () => {
    const scores = computeDimensionScores({});
    for (const dim of SCORE_DIMENSIONS) {
      assert.ok(typeof scores[dim] === "number", `${dim} should be a number`);
    }
    // comprehension = 3 when q19 is missing
    assert.strictEqual(scores.comprehension, 3);
  });

  it("handles missing q10 (data types) gracefully", () => {
    // q10 defaults to [] when missing
    const scores = computeDimensionScores({ q9: "yes" });
    assert.strictEqual(scores.dataSensitivity, 0);
  });

  it("handles missing q3 (users) gracefully", () => {
    const scores = computeDimensionScores({});
    assert.strictEqual(scores.blastRadius, 0);
  });

  it("handles missing q11 (storage) gracefully in escalation check", () => {
    const esc = checkEscalations({ q10: [] });
    assert.ok(Array.isArray(esc));
  });

  it("computeWeightedPercentage handles missing score keys", () => {
    // Partial scores object — missing some dimensions
    const pct = computeWeightedPercentage({ security: 2 }, "other");
    assert.ok(typeof pct === "number");
    assert.ok(pct >= 0 && pct <= 1);
  });

  it("routeToTrack handles 0 exactly", () => {
    assert.strictEqual(routeToTrack(0, false), 1);
  });

  it("routeToTrack handles 1.0 exactly", () => {
    assert.strictEqual(routeToTrack(1.0, false), 4);
  });
});

// ===========================================================================
// Artifact-type gaming guard (FW-05)
// ===========================================================================

describe("artifact-type gaming guard (FW-05)", () => {
  // Memo boundary flip 2: public-auth SSO app with an LLM feature.
  const answers = {
    q3: ["department"], q5: "public-auth", q6: "sso", q8: "<50",
    q9: "yes", q10: ["internal"], q11: ["campus"], q12: "approved-dpa",
    q15: "campus-repo", q16: "documented", q17: "active", q18: "team-runbooks",
    q19: "x".repeat(250), q20: "short", q21: "yes",
  };

  it("declaring ai-agent no longer yields a lower track than internal-app", () => {
    const asInternal = computeTrack({ ...answers, q1: "internal-app" });
    const asAgent = computeTrack({ ...answers, q1: "ai-agent" });
    assert.ok(asAgent.track >= asInternal.track,
      `ai-agent track ${asAgent.track} < internal-app track ${asInternal.track}`);
  });

  it("applicable profiles derive from answers, not just q1", () => {
    const profiles = applicableProfiles({ ...answers, q1: "ai-agent" }, "ai-agent");
    assert.ok(profiles.includes("ai-agent"));
    assert.ok(profiles.includes("internal-app")); // public-auth surface
  });

  it("public-noauth adds the public-site profile", () => {
    const profiles = applicableProfiles({ q1: "script-api", q5: "public-noauth" }, "script-api");
    assert.ok(profiles.includes("public-site"));
  });

  it("no extra profiles for an internal-server script", () => {
    const profiles = applicableProfiles({ q1: "script-api", q5: "internal-server", q12: "no" }, "script-api");
    assert.deepStrictEqual(profiles, ["script-api"]);
  });

  it("q1 alone can never lower the track (sweep)", () => {
    const base = { ...answers };
    for (const declared of VALID_ARTIFACT_TYPES) {
      const withDeclared = computeTrack({ ...base, q1: declared });
      // The internal-app surface profile is always applicable here, so every
      // declaration must route at least as high as the surface demands.
      const surfaceOnly = computeTrack({ ...base, q1: "internal-app" });
      assert.ok(withDeclared.track >= surfaceOnly.track,
        `declaring ${declared} routed Track ${withDeclared.track} < ${surfaceOnly.track}`);
    }
  });
});

// ===========================================================================
// frontend/backend computeTrack parity
// ===========================================================================

describe("frontend/backend computeTrack parity", () => {
  const cases = [
    { q1: "internal-app", q3: ["department"], q5: "public-auth", q6: "sso", q9: "yes", q10: ["internal"], q11: ["campus"], q12: "approved-dpa", q15: "campus-repo", q16: "documented", q17: "active", q18: "team-runbooks", q19: "x".repeat(250), q20: "short", q21: "yes" },
    { q1: "ai-agent", q3: ["students"], q5: "public-auth", q6: "sso", q9: "yes", q10: ["ferpa"], q11: ["campus"], q12: "approved-dpa", q15: "campus-repo", q16: "documented", q17: "active", q18: "team-runbooks", q19: "x".repeat(250), q20: "short", q21: "yes" },
    { q1: "public-site", q3: ["public"], q5: "public-noauth", q9: "no", q15: "campus-repo", q16: "documented", q17: "occasional", q18: "team-runbooks" },
  ];
  it("routes identically for representative answer sets", () => {
    for (const a of cases) {
      assert.strictEqual(feComputeTrack(a).track, computeTrack(a).track, JSON.stringify(a.q1));
    }
  });
});

// ===========================================================================
// comprehension is a universal dimension (FW-04)
// ===========================================================================

describe("comprehension is a universal dimension (FW-04)", () => {
  it("a thorough q19 zeroes comprehension for a non-AI tool", () => {
    const s = computeDimensionScores({ q1: "internal-app", q19: "x".repeat(250) });
    assert.strictEqual(s.comprehension, 0);
  });
  it("an unanswered q19 scores 3 (the question is always asked)", () => {
    const s = computeDimensionScores({ q1: "internal-app" });
    assert.strictEqual(s.comprehension, 3);
  });
});

// ===========================================================================
// structured q20 autonomy + new escalators (improvement 17)
// ===========================================================================

describe("structured q20 autonomy (improvement 17)", () => {
  it("maps decision-scope enum to autonomy score", () => {
    assert.strictEqual(computeDimensionScores({ q20: "none", q21: "yes" }).autonomy, 0);
    assert.strictEqual(computeDimensionScores({ q20: "recommends", q21: "yes" }).autonomy, 1);
    assert.strictEqual(computeDimensionScores({ q20: "acts-with-override", q21: "yes" }).autonomy, 2);
    assert.strictEqual(computeDimensionScores({ q20: "autonomous", q21: "yes" }).autonomy, 3);
  });
  it("no disclosure adds one point, capped at 3", () => {
    assert.strictEqual(computeDimensionScores({ q20: "recommends", q21: "no" }).autonomy, 2);
    assert.strictEqual(computeDimensionScores({ q20: "autonomous", q21: "no" }).autonomy, 3);
  });
  it("legacy free-text q20 keeps the old +1 heuristic", () => {
    assert.strictEqual(computeDimensionScores({ q20: "a human reviews everything", q21: "yes" }).autonomy, 1);
    assert.strictEqual(computeDimensionScores({ q20: "short", q21: "yes" }).autonomy, 0);
  });
  it("prototype keys in q20 do not poison autonomy (Object.hasOwn guard)", () => {
    const s = computeDimensionScores({ q20: "constructor", q21: "yes" });
    assert.strictEqual(s.autonomy, 1); // legacy free-text branch: length > 10
  });
});

describe("new escalators (improvement 17)", () => {
  it("payment data escalates", () => {
    const e = checkEscalations({ q9: "yes", q10: ["payment"] });
    assert.ok(e.includes("Payment card data (PCI DSS)"));
  });
  it("autonomous decisions escalate", () => {
    const e = checkEscalations({ q20: "autonomous" });
    assert.ok(e.includes("Autonomous decisions without human review"));
  });
  it("acts-with-override does not escalate", () => {
    const e = checkEscalations({ q20: "acts-with-override" });
    assert.ok(!e.includes("Autonomous decisions without human review"));
  });
});
