import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findContradictions, evaluateActivationGate } from "./activation-gate.js";

const cleanSynthesis = {
  authentication: { primary: "institutional_SSO", hasInstitutionalSSO: true, ssoEvidence: "src/auth.js:10" },
  escalationSignals: {
    noInstitutionalSSO: { triggered: false },
    studentFacingNoDisclosure: { triggered: false },
  },
  dataOperations: [{ type: "read", what: "config", where: "src/config.js:3", classification: "internal" }],
  aiUsage: { dataTransmittedToAI: false },
  findings: [],
};

describe("findContradictions (FW-02)", () => {
  it("returns nothing when intake and code agree", () => {
    const a = { q6: "sso", q9: "yes", q10: ["internal"], q12: "no", q21: "yes" };
    assert.deepEqual(findContradictions(a, cleanSynthesis), []);
  });

  it("flags claimed SSO the code does not have", () => {
    const synth = { ...cleanSynthesis, authentication: { primary: "JWT_only", hasInstitutionalSSO: false } };
    const c = findContradictions({ q6: "sso" }, synth);
    assert.equal(c.length, 1);
    assert.equal(c[0].question, "q6");
  });

  it("flags 'no data' intake when code touches FERPA data", () => {
    const synth = { ...cleanSynthesis, dataOperations: [{ type: "read", what: "student grades", where: "src/db.js:44", classification: "FERPA" }] };
    const c = findContradictions({ q9: "no" }, synth);
    assert.ok(c.some(x => x.question === "q9/q10"));
  });

  it("flags undeclared FERPA when q10 omits it", () => {
    const synth = { ...cleanSynthesis, dataOperations: [{ type: "read", what: "advising notes", where: "src/db.js:70", classification: "FERPA" }] };
    const c = findContradictions({ q9: "yes", q10: ["internal"] }, synth);
    assert.ok(c.some(x => x.question === "q10"));
  });

  it("flags claimed AI disclosure the code contradicts", () => {
    const synth = { ...cleanSynthesis, escalationSignals: { ...cleanSynthesis.escalationSignals, studentFacingNoDisclosure: { triggered: true, evidence: "src/Chat.jsx:12" } } };
    const c = findContradictions({ q21: "yes" }, synth);
    assert.ok(c.some(x => x.question === "q21"));
  });

  it("flags 'no external AI' when code transmits data to AI", () => {
    const synth = { ...cleanSynthesis, aiUsage: { dataTransmittedToAI: true, transmissionEvidence: "src/llm.js:9" } };
    const c = findContradictions({ q12: "no" }, synth);
    assert.ok(c.some(x => x.question === "q12"));
  });

  it("tolerates missing synthesis (no crash, no contradictions)", () => {
    assert.deepEqual(findContradictions({ q6: "sso" }, null), []);
  });
});

describe("evaluateActivationGate", () => {
  const answers = { q6: "sso", q9: "yes", q10: ["internal"], q12: "no", q21: "yes" };

  it("activates a clean Track 1 run", () => {
    const g = evaluateActivationGate({ track: 1, answers, codeSynthesis: cleanSynthesis, partial: false, truncated: false });
    assert.equal(g.activate, true);
    assert.equal(g.blocked, false);
  });

  it("blocks on contradiction", () => {
    const synth = { ...cleanSynthesis, authentication: { hasInstitutionalSSO: false, primary: "none" } };
    const g = evaluateActivationGate({ track: 1, answers, codeSynthesis: synth, partial: false, truncated: false });
    assert.equal(g.activate, false);
    assert.equal(g.blocked, true);
    assert.ok(g.reasons.length >= 1);
  });

  it("blocks on confirmed critical finding", () => {
    const synth = { ...cleanSynthesis, findings: [{ severity: "critical", confidence: "confirmed", title: "Live key in repo" }] };
    const g = evaluateActivationGate({ track: 1, answers, codeSynthesis: synth, partial: false, truncated: false });
    assert.equal(g.blocked, true);
  });

  it("blocks on partial analysis and on truncation", () => {
    assert.equal(evaluateActivationGate({ track: 1, answers, codeSynthesis: cleanSynthesis, partial: true, truncated: false }).blocked, true);
    assert.equal(evaluateActivationGate({ track: 1, answers, codeSynthesis: cleanSynthesis, partial: false, truncated: true }).blocked, true);
  });

  it("does not apply to Tracks 2-4", () => {
    const g = evaluateActivationGate({ track: 3, answers, codeSynthesis: cleanSynthesis, partial: false, truncated: false });
    assert.equal(g.activate, false);
    assert.equal(g.blocked, false);
  });
});
