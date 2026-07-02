import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleCodebase } from "./codebase-bundle.js";

describe("bundleCodebase budget", () => {
  it("never exceeds maxChars even with an oversized README", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bundle-"));
    writeFileSync(join(dir, "README.md"), "x".repeat(50000));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "t" }));
    writeFileSync(join(dir, "index.js"), "y".repeat(50000));
    const res = await bundleCodebase(dir, { maxChars: 20000 });
    assert.ok(res.bundle.length <= 20000 + 2000, `bundle ${res.bundle.length} exceeds budget`);
    assert.equal(res.truncated, true);
  });
});
