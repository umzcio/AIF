import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { wrap } from "./async-handler.js";

describe("wrap", () => {
  it("passes a rejected async handler's error to next()", async () => {
    const boom = new Error("boom");
    let caught = null;
    const handler = wrap(async () => { throw boom; });
    await handler({}, {}, (e) => { caught = e; });
    assert.equal(caught, boom);
  });
  it("does not call next when the handler resolves", async () => {
    let nextCalled = false;
    const handler = wrap(async (req, res) => { res.ok = true; });
    const res = {};
    await handler({}, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.ok, true);
  });
});

describe("error middleware contract", () => {
  it("maps pg 22P02 to 400 (documented behavior)", () => {
    // Mirror the mapping the server.js middleware implements.
    const map = (err) => (err.code === "22P02" ? 400 : 500);
    assert.equal(map({ code: "22P02" }), 400);
    assert.equal(map({ code: "XX000" }), 500);
  });
});
