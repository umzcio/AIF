import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateAgainstSchema } from "./validate-output.js";

const SCHEMA = {
  type: "object",
  required: ["findings"],
  properties: {
    findings: { type: "array", items: { type: "object" } },
  },
};

describe("validateAgainstSchema", () => {
  it("fails when a required top-level key is missing", () => {
    const res = validateAgainstSchema({ summary: "no findings key" }, SCHEMA);
    assert.equal(res.ok, false);
    assert.ok(res.errors.length > 0);
  });

  it("fails when findings is not an array", () => {
    const res = validateAgainstSchema({ findings: "not an array" }, SCHEMA);
    assert.equal(res.ok, false);
    assert.ok(res.errors.length > 0);
  });

  it("fails when findings contains a non-object item", () => {
    const res = validateAgainstSchema({ findings: ["a string", 42, null] }, SCHEMA);
    assert.equal(res.ok, false);
    assert.ok(res.errors.length > 0);
  });

  it("passes for a well-formed minimal object", () => {
    const res = validateAgainstSchema({ findings: [{ title: "ok" }] }, SCHEMA);
    assert.equal(res.ok, true);
    assert.deepEqual(res.errors, []);
  });

  it("passes when findings array is empty", () => {
    const res = validateAgainstSchema({ findings: [] }, SCHEMA);
    assert.equal(res.ok, true);
  });

  it("does not enforce additionalProperties:false — extra keys pass", () => {
    const res = validateAgainstSchema(
      { findings: [{ title: "ok" }], extraTopLevelKey: { anything: "goes" } },
      SCHEMA
    );
    assert.equal(res.ok, true);
  });

  it("does not require optional nested fields to be present", () => {
    const schema = {
      type: "object",
      required: ["findings"],
      properties: {
        findings: {
          type: "array",
          items: {
            type: "object",
            required: ["severity"],
            properties: { severity: { type: "string" }, evidence: { type: "string" } },
          },
        },
      },
    };
    // "evidence" is declared in properties but not required — omitting it must still pass.
    const res = validateAgainstSchema({ findings: [{ severity: "high" }] }, schema);
    assert.equal(res.ok, true);
  });

  it("handles a union type array (e.g. [\"string\",\"null\"]) — null is acceptable", () => {
    const schema = {
      type: "object",
      properties: { ssoProvider: { type: ["string", "null"] } },
    };
    const res = validateAgainstSchema({ ssoProvider: null }, schema);
    assert.equal(res.ok, true);
  });

  it("treats a schema without a type as pass-through", () => {
    const schema = { properties: { anything: {} } };
    const res = validateAgainstSchema({ anything: 42 }, schema);
    assert.equal(res.ok, true);
  });

  it("recurses into nested required objects (e.g. scoringSignals.security)", () => {
    const schema = {
      type: "object",
      required: ["scoringSignals"],
      properties: {
        scoringSignals: {
          type: "object",
          required: ["security"],
          properties: {
            security: {
              type: "object",
              required: ["score", "reasoning"],
              properties: { score: { type: "number" }, reasoning: { type: "string" } },
            },
          },
        },
      },
    };
    const bad = validateAgainstSchema({ scoringSignals: { security: { score: 2 } } }, schema);
    assert.equal(bad.ok, false);

    const good = validateAgainstSchema(
      { scoringSignals: { security: { score: 2, reasoning: "fine" } } },
      schema
    );
    assert.equal(good.ok, true);
  });
});
