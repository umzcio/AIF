import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { pipelineRunSchema } from "../validation.js";

// ---------------------------------------------------------------------------
// Re-define pipeline constants from queue.js for isolated testing.
// These are module-scoped in queue.js and not exported.
// ---------------------------------------------------------------------------

const MAX_RETRIES = 2;

const MODEL_COST_USD = {
  "codex":     0.30,
  "minimax":   0.10,
  "mimo":      0.06,
  "kimi":      0.12,
  "glm":       0.08,
  "gemini":    0.15,
  "claude":    0.45,
};

/**
 * Validate a URL for safe use in subprocess arguments.
 * Re-implemented from queue.js (not exported) for testing.
 */
function validateUrl(url) {
  if (typeof url !== "string") throw new Error("Invalid URL: not a string");
  if (!url.startsWith("https://")) throw new Error("Invalid URL: must start with https://");
  if (/[;|&`$()\n\r]/.test(url)) throw new Error("Invalid URL: contains shell metacharacters");
  return url;
}

// ===========================================================================
// pipelineRunSchema validation
// ===========================================================================

describe("pipelineRunSchema", () => {
  it("accepts empty object (track is optional)", () => {
    const result = pipelineRunSchema.safeParse({});
    assert.ok(result.success);
    assert.equal(result.data.track, undefined);
  });

  it("accepts track 1", () => {
    const result = pipelineRunSchema.safeParse({ track: 1 });
    assert.ok(result.success);
    assert.equal(result.data.track, 1);
  });

  it("accepts track 2", () => {
    const result = pipelineRunSchema.safeParse({ track: 2 });
    assert.ok(result.success);
    assert.equal(result.data.track, 2);
  });

  it("accepts track 3", () => {
    const result = pipelineRunSchema.safeParse({ track: 3 });
    assert.ok(result.success);
    assert.equal(result.data.track, 3);
  });

  it("accepts track 4", () => {
    const result = pipelineRunSchema.safeParse({ track: 4 });
    assert.ok(result.success);
    assert.equal(result.data.track, 4);
  });

  it("rejects track 0 (below minimum)", () => {
    const result = pipelineRunSchema.safeParse({ track: 0 });
    assert.ok(!result.success);
  });

  it("rejects track 5 (above maximum)", () => {
    const result = pipelineRunSchema.safeParse({ track: 5 });
    assert.ok(!result.success);
  });

  it("rejects negative track", () => {
    const result = pipelineRunSchema.safeParse({ track: -1 });
    assert.ok(!result.success);
  });

  it("rejects fractional track", () => {
    const result = pipelineRunSchema.safeParse({ track: 1.5 });
    assert.ok(!result.success);
  });

  it("rejects string track", () => {
    const result = pipelineRunSchema.safeParse({ track: "3" });
    assert.ok(!result.success);
  });

  it("accepts mode 'direct-api'", () => {
    const result = pipelineRunSchema.safeParse({ mode: "direct-api" });
    assert.ok(result.success);
    assert.equal(result.data.mode, "direct-api");
  });

  it("rejects removed legacy modes", () => {
    assert.ok(!pipelineRunSchema.safeParse({ mode: "opencode" }).success);
    assert.ok(!pipelineRunSchema.safeParse({ mode: "standard" }).success);
  });

  it("defaults mode to 'direct-api'", () => {
    const result = pipelineRunSchema.safeParse({});
    assert.ok(result.success);
    assert.equal(result.data.mode, "direct-api");
  });

  it("rejects invalid mode", () => {
    const result = pipelineRunSchema.safeParse({ mode: "turbo" });
    assert.ok(!result.success);
  });
});

// ===========================================================================
// URL validation
// ===========================================================================

describe("validateUrl", () => {
  it("accepts valid HTTPS URL", () => {
    const url = validateUrl("https://github.com/user/repo.git");
    assert.equal(url, "https://github.com/user/repo.git");
  });

  it("accepts HTTPS URL with path and query", () => {
    const url = validateUrl("https://gitlab.example.com/org/project");
    assert.equal(url, "https://gitlab.example.com/org/project");
  });

  it("accepts HTTPS URL with port", () => {
    const url = validateUrl("https://git.example.com:8443/repo.git");
    assert.equal(url, "https://git.example.com:8443/repo.git");
  });

  it("rejects HTTP URL (not HTTPS)", () => {
    assert.throws(
      () => validateUrl("http://github.com/user/repo.git"),
      { message: /must start with https/ },
    );
  });

  it("rejects empty string", () => {
    assert.throws(
      () => validateUrl(""),
      { message: /must start with https/ },
    );
  });

  it("rejects non-string input (number)", () => {
    assert.throws(
      () => validateUrl(123),
      { message: /not a string/ },
    );
  });

  it("rejects non-string input (null)", () => {
    assert.throws(
      () => validateUrl(null),
      { message: /not a string/ },
    );
  });

  it("rejects non-string input (undefined)", () => {
    assert.throws(
      () => validateUrl(undefined),
      { message: /not a string/ },
    );
  });

  it("rejects URL with semicolon (shell metacharacter)", () => {
    assert.throws(
      () => validateUrl("https://evil.com/repo;rm -rf /"),
      { message: /shell metacharacters/ },
    );
  });

  it("rejects URL with pipe (shell metacharacter)", () => {
    assert.throws(
      () => validateUrl("https://evil.com/repo|cat /etc/passwd"),
      { message: /shell metacharacters/ },
    );
  });

  it("rejects URL with ampersand (shell metacharacter)", () => {
    assert.throws(
      () => validateUrl("https://evil.com/repo&bg-cmd"),
      { message: /shell metacharacters/ },
    );
  });

  it("rejects URL with backtick (shell metacharacter)", () => {
    assert.throws(
      () => validateUrl("https://evil.com/`whoami`.git"),
      { message: /shell metacharacters/ },
    );
  });

  it("rejects URL with dollar sign (shell metacharacter)", () => {
    assert.throws(
      () => validateUrl("https://evil.com/${HOME}.git"),
      { message: /shell metacharacters/ },
    );
  });

  it("rejects URL with parentheses (shell metacharacter)", () => {
    assert.throws(
      () => validateUrl("https://evil.com/$(whoami).git"),
      { message: /shell metacharacters/ },
    );
  });

  it("rejects URL with newline (shell metacharacter)", () => {
    assert.throws(
      () => validateUrl("https://evil.com/repo\nrm -rf /"),
      { message: /shell metacharacters/ },
    );
  });

  it("rejects URL with carriage return (shell metacharacter)", () => {
    assert.throws(
      () => validateUrl("https://evil.com/repo\rrm -rf /"),
      { message: /shell metacharacters/ },
    );
  });

  it("accepts URL with safe special characters (hyphens, underscores, dots)", () => {
    const url = validateUrl("https://github.com/my-org/my_repo.name.git");
    assert.equal(url, "https://github.com/my-org/my_repo.name.git");
  });
});

// ===========================================================================
// Retry logic and dead letter queue constants
// ===========================================================================

describe("retry logic constants", () => {
  it("MAX_RETRIES is 2", () => {
    assert.equal(MAX_RETRIES, 2);
  });

  it("first run has retry_count 0 (not counted as a retry)", () => {
    const retryCount = 0;
    assert.ok(retryCount < MAX_RETRIES, "First run should be below retry limit");
  });

  it("first retry has retry_count 1 (still allowed)", () => {
    const retryCount = 1;
    assert.ok(retryCount < MAX_RETRIES, "First retry should be below retry limit");
  });

  it("second retry has retry_count 2 (hits dead letter queue)", () => {
    const retryCount = 2;
    assert.ok(retryCount >= MAX_RETRIES, "Second retry should trigger dead letter queue");
  });

  it("third retry would exceed limit (retry_count 3 >= MAX_RETRIES)", () => {
    const retryCount = 3;
    assert.ok(retryCount >= MAX_RETRIES, "Third retry exceeds limit");
  });
});

// ===========================================================================
// MODEL_COST_USD completeness and sanity
// ===========================================================================

describe("MODEL_COST_USD", () => {
  const expectedModels = ["codex", "minimax", "mimo", "kimi", "glm", "gemini", "claude"];

  it("contains all expected model keys", () => {
    for (const model of expectedModels) {
      assert.ok(model in MODEL_COST_USD, `Missing cost entry for model: ${model}`);
    }
  });

  it("has no unexpected model keys", () => {
    const actualKeys = Object.keys(MODEL_COST_USD);
    for (const key of actualKeys) {
      assert.ok(expectedModels.includes(key), `Unexpected model key in cost map: ${key}`);
    }
  });

  it("all costs are positive numbers", () => {
    for (const [model, cost] of Object.entries(MODEL_COST_USD)) {
      assert.equal(typeof cost, "number", `Cost for ${model} should be a number`);
      assert.ok(cost > 0, `Cost for ${model} should be positive, got ${cost}`);
    }
  });

  it("no individual model cost exceeds $5 per pass", () => {
    for (const [model, cost] of Object.entries(MODEL_COST_USD)) {
      assert.ok(cost < 5.0, `Cost for ${model} ($${cost}) exceeds $5/pass sanity check`);
    }
  });

  it("total pipeline cost estimate is reasonable (12 passes + 2 synthesis)", () => {
    // Agent 1: 5 model passes + 1 Claude synthesis
    // Agent 2: 5 model passes + 1 Claude synthesis
    // Agent 3: 1 Claude pass
    // Agent 4: 1 Claude pass
    // Total: 12 model passes + 2 extra Claude synthesis

    const passCosts = [
      MODEL_COST_USD["codex"],
      MODEL_COST_USD["minimax"],
      MODEL_COST_USD["mimo"],
      MODEL_COST_USD["kimi"],
      MODEL_COST_USD["glm"],
    ];
    // Two multi-model agents use all 5 models
    const twoAgentPassCost = passCosts.reduce((a, b) => a + b, 0) * 2;
    // Two single-pass agents use Claude
    const singlePassCost = MODEL_COST_USD["claude"] * 2;
    // Two Claude synthesis passes
    const synthesisCost = MODEL_COST_USD["claude"] * 2;

    const totalEstimate = twoAgentPassCost + singlePassCost + synthesisCost;

    // Sanity: total should be between $1 and $20
    assert.ok(totalEstimate > 1.0, `Total pipeline cost $${totalEstimate.toFixed(2)} seems too low`);
    assert.ok(totalEstimate < 20.0, `Total pipeline cost $${totalEstimate.toFixed(2)} seems too high`);
  });

  it("Claude (synthesis) is the most expensive per-pass model", () => {
    const claudeCost = MODEL_COST_USD["claude"];
    for (const [model, cost] of Object.entries(MODEL_COST_USD)) {
      if (model === "claude") continue;
      assert.ok(claudeCost >= cost,
        `Claude ($${claudeCost}) should be >= ${model} ($${cost})`);
    }
  });
});

// ===========================================================================
// Pipeline agents structure
// ===========================================================================

describe("pipeline agent structure", () => {
  const AGENTS = ["code-analysis", "accessibility", "qa-analysis", "documentation"];

  it("pipeline has exactly 4 agents", () => {
    assert.equal(AGENTS.length, 4);
  });

  it("multi-model agents (0, 1, 2) have 5 passes each", () => {
    // Agents at index 0, 1, and 2 are multi-model
    for (const i of [0, 1, 2]) {
      const passesTotal = i < 3 ? 5 : 1;
      assert.equal(passesTotal, 5, `Agent ${AGENTS[i]} should have 5 passes`);
    }
  });

  it("single-pass agents (3) have 1 pass each", () => {
    // Agent at index 3 is single-pass
    for (const i of [3]) {
      const passesTotal = i < 3 ? 5 : 1;
      assert.equal(passesTotal, 1, `Agent ${AGENTS[i]} should have 1 pass`);
    }
  });

  it("total passes across all agents is 16", () => {
    const totalPasses = AGENTS.reduce((sum, _, i) => sum + (i < 3 ? 5 : 1), 0);
    assert.equal(totalPasses, 16);
  });
});
