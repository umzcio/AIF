# Phase 1 Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 15 findings (FW-01..FW-15) and implement the 20 ranked improvements from `reviews/phase1-framework-memo.md`, except the three explicitly deferred L-effort research items (differentiated-lens redesign, bundle sharding across passes, annual re-attestation), whose S-effort portions ARE included.

**Architecture:** Backend is Node.js ESM + Express + PostgreSQL (migrations in `backend/migrations/`, next number is 015). Frontend is Vite+React. Scoring logic exists twice by design: `backend/src/scoring.js` (authoritative) and `frontend/src/constants.js` (preview-only), with parity enforced by `backend/src/scoring.test.js`. Every scoring change in this plan lands in BOTH files plus tests. Validation is zod (`backend/src/validation.js`); there is no ajv. Tests use the Node built-in runner (`node:test`, `describe`/`it`, `assert` from `node:assert` or `node:assert/strict`).

**Tech Stack:** Node 20+ ESM, Express 4, pg, zod 4, React 18 + Vite, node:test.

## Global Constraints

- No new npm dependencies. Validation uses zod; JSON-shape checks are hand-rolled.
- Migrations are append-only, numbered sequentially: this plan adds `015_floor_conditions.sql`, `016_activation_gate.sql`, `017_pass_tokens.sql`, `018_tool_versions.sql`. Use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` like migrations 005/006 do.
- After every backend task: `cd /projects/AIF/backend && npm test` must pass (267+ tests).
- After every frontend task: `cd /projects/AIF/frontend && npm run build` must succeed.
- Frontend/backend scoring parity: any change to `computeDimensionScores`, `checkEscalations`, `checkFloors`, `applicableProfiles`, or thresholds must be made identically in `backend/src/scoring.js` and `frontend/src/constants.js` (frontend versions are module-private except `computeTrack` and `WEIGHT_MATRIX`).
- Frontend components use the `C` color constant, never hardcoded hex. Match existing inline-style idiom.
- Commit after each task with a conventional message (`fix:`, `feat:`, `docs:`, `test:`). Do not push.
- Docs style (from repo CLAUDE.md): direct, no fluff; if something isn't built, say so explicitly.
- Some existing tests assert behavior this plan removes (e.g. `pipeline.test.js` "accepts track 1"). Rewriting those tests is part of the task that changes the behavior — never delete a test without replacing it with one asserting the new behavior.

---

### Task 1: FW-01 — Remove builder-supplied track from pipeline runs; derive activation from the tool

**Files:**
- Modify: `backend/src/validation.js:62-65`
- Modify: `backend/src/routes/pipeline.js:50-61`
- Modify: `backend/src/pipeline/queue.js` (completion block, lines ~322-374)
- Modify: `backend/src/routes/pipeline.test.js` (track tests, lines ~39-81)
- Modify: `frontend/src/api.js:165-173`
- Modify: frontend callers of `startPipelineRun` (grep: `grep -rn "startPipelineRun" frontend/src`)

**Interfaces:**
- Produces: `pipelineRunSchema` = `z.object({ mode: z.enum(["direct-api"]).default("direct-api") })` (no `track`; zod strips unknown keys, so clients sending `track` are silently ignored).
- Produces: `enqueue(toolId, track = null, parentRunId, mode)` unchanged signature — `track` is now internal-only (retry path). Route always passes `null`.
- Produces: completion status derived from a fresh `SELECT track, owner_id, name, intake_answers FROM tools` query, not `next.track`. Later tasks (12) consume `freshTool` in the same block.

- [ ] **Step 1: Rewrite the track tests to assert the new contract** in `backend/src/routes/pipeline.test.js`. Replace the block of tests `"accepts track 1"` through `"rejects negative track"` (lines ~45-81) with:

```js
  it("ignores a client-supplied track (stripped by schema)", () => {
    const result = pipelineRunSchema.safeParse({ track: 1 });
    assert.ok(result.success);
    assert.equal(result.data.track, undefined);
  });

  it("ignores track for all values 1-4", () => {
    for (const t of [1, 2, 3, 4]) {
      const result = pipelineRunSchema.safeParse({ track: t, mode: "direct-api" });
      assert.ok(result.success);
      assert.equal(result.data.track, undefined);
      assert.equal(result.data.mode, "direct-api");
    }
  });
```

Keep the existing `"accepts empty object"` test (line 39) but update its comment/name: `it("accepts empty object (mode defaults)")`.

- [ ] **Step 2: Run tests to verify they fail**: `cd /projects/AIF/backend && node --test src/routes/pipeline.test.js` — expect FAIL (`result.data.track` is currently `1`).

- [ ] **Step 3: Change the schema** in `backend/src/validation.js`:

```js
export const pipelineRunSchema = z.object({
  mode: z.enum(["direct-api"]).default("direct-api"),
});
```

- [ ] **Step 4: Change the route** in `backend/src/routes/pipeline.js:50-61`:

```js
router.post("/:toolId/run", requireOwnerOrRole("admin"), validate(pipelineRunSchema), async (req, res) => {
  const { toolId } = req.params;
  const { mode } = req.validated;

  try {
    const run = await enqueue(toolId, null, null, mode);
    res.status(201).json({ run });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 5: Derive completion status from the tool, not the run row**, in `backend/src/pipeline/queue.js`. Replace lines 322-345 (from the `// Track-based auto-status` comment through the `const { rows: [completedTool] }` query) with:

```js
    // Track-based auto-status on pipeline completion.
    // The track is read fresh from the tool (never from the run row) so a
    // mid-run track override is respected and run creation cannot influence it.
    const { rows: [freshTool] } = await pool.query(
      "SELECT track, owner_id, name, intake_answers FROM tools WHERE id = $1", [next.tool_id]
    );
    const effectiveTrack = freshTool?.track ?? next.track;
    const newStatus = effectiveTrack === 1 ? "active" : "under_review";

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE pipeline_runs SET status = 'completed', output_dir = $1, summary = $2, completed_at = NOW() WHERE id = $3`,
        [result.outputDir, JSON.stringify(result.agents), runId]
      );
      await client.query(
        `UPDATE tools SET status = $1, updated_at = NOW() WHERE id = $2`,
        [newStatus, next.tool_id]
      );
    });

    // Compute and store pipeline metrics (non-critical, outside transaction)
    computePipelineMetrics(runId).catch(err => log.error("Metrics computation failed", { runId, error: err.message }));
    emitProgress(runId, { type: "status", status: "completed" });

    // Notify tool owner of pipeline completion
    const completedTool = freshTool;
```

Then in the notification block that follows, replace every remaining `next.track` with `effectiveTrack` (three occurrences: the `pipelineTitle` ternary, the `body` string `Track ${next.track} tool`, and the `reviewTitle`).

- [ ] **Step 6: Frontend — stop sending track.** In `frontend/src/api.js:165-173`:

```js
export async function startPipelineRun(toolId, mode) {
  const body = {};
  if (mode) body.mode = mode;
  const res = await request(`/pipeline/${toolId}/run`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.json();
}
```

Run `grep -rn "startPipelineRun" frontend/src` and update every caller to drop the track argument (e.g. `startPipelineRun(tool.id, track)` → `startPipelineRun(tool.id)`; a caller passing a mode keeps it as the second arg).

- [ ] **Step 7: Verify**: `cd /projects/AIF/backend && npm test` — PASS. `cd /projects/AIF/frontend && npm run build` — PASS.

- [ ] **Step 8: Commit**: `git add -A && git commit -m "fix: remove client-supplied track from pipeline runs (FW-01)"`

---

### Task 2: FW-06 — Split the FERPA escalation; add track floors (migration 015)

**Files:**
- Create: `backend/migrations/015_floor_conditions.sql`
- Modify: `backend/src/scoring.js`
- Modify: `frontend/src/constants.js`
- Modify: `backend/src/routes/intake.js` (persist floors)
- Modify: `backend/src/scoring.test.js`
- Modify: `frontend/src/components/IntakeForm.jsx` (sidebar floors display)

**Interfaces:**
- Produces: `checkFloors(answers)` → `[{ track: 3, reason: string }]` exported from `scoring.js` (and module-private in `constants.js`).
- Produces: `routeToTrack(weightedPct, hasEscalation, floorTrack = 1)` — third param, backward compatible.
- Produces: `computeTrack(answers, artifactType)` return gains `floors` array.
- Produces: `tools.floor_conditions JSONB DEFAULT '[]'` column.
- New escalation semantics: `ferpa && public-noauth` → Track 4 escalation; `ferpa && public-auth && q6 !== "sso"` → Track 4 escalation; `ferpa && public-auth && q6 === "sso"` → Track 3 floor (no escalation).

- [ ] **Step 1: Write failing tests** in `backend/src/scoring.test.js` (append new describe blocks):

```js
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
```

Add `checkFloors` to the import list at the top of the test file.

- [ ] **Step 2: Run to verify failure**: `node --test src/scoring.test.js` — FAIL (checkFloors not exported; FERPA+public-auth+sso currently escalates).

- [ ] **Step 3: Implement in `backend/src/scoring.js`.** Replace `checkEscalations` line 67 with:

```js
  if (dt.includes("ferpa") && (a.q5 === "public-noauth" || (a.q5 === "public-auth" && a.q6 !== "sso"))) e.push("FERPA + public-facing deployment");
```

Add after `checkEscalations`:

```js
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
```

Change `routeToTrack`:

```js
export function routeToTrack(weightedPct, hasEscalation, floorTrack = 1) {
  if (hasEscalation) return 4;
  let track;
  if (weightedPct >= 0.65) track = 4;
  else if (weightedPct >= 0.42) track = 3;
  else if (weightedPct >= 0.22) track = 2;
  else track = 1;
  return Math.max(track, floorTrack);
}
```

Change `computeTrack`:

```js
export function computeTrack(answers, artifactType) {
  const scores = computeDimensionScores(answers);
  const escalations = checkEscalations(answers);
  const floors = checkFloors(answers);
  const key = artifactType || answers.q1 || "other";
  const pct = computeWeightedPercentage(scores, key);
  const floorTrack = floors.reduce((m, f) => Math.max(m, f.track), 1);
  const track = routeToTrack(pct, escalations.length > 0, floorTrack);
  return { track, scores, escalations, floors, weightedPct: pct };
}
```

- [ ] **Step 4: Mirror in `frontend/src/constants.js`.** Apply the same one-line change to the FERPA condition inside the private `checkEscalations`, add a private `checkFloors(a)` (same body), and update `computeTrack` (keep its existing return shape, adding `floors`):

```js
export function computeTrack(a) {
  const key = a.q1 || "other";
  const w = WEIGHT_MATRIX[key] || WEIGHT_MATRIX["other"];
  const d = computeDimensionScores(a);
  const esc = checkEscalations(a);
  const floors = checkFloors(a);
  let total = 0, max = 0;
  for (const k of Object.keys(d)) { total += d[k] * (w[k] || 0); max += 3 * (w[k] || 0); }
  const pct = max > 0 ? total / max : 0;
  const floorTrack = floors.reduce((m, f) => Math.max(m, f.track), 1);
  let track;
  if (esc.length > 0 || pct >= 0.65) track = 4;
  else if (pct >= 0.42) track = 3;
  else if (pct >= 0.22) track = 2;
  else track = 1;
  if (esc.length === 0) track = Math.max(track, floorTrack);
  return { track, total, max, pct, dims: d, weights: w, escalations: esc, floors };
}
```

- [ ] **Step 5: Migration** `backend/migrations/015_floor_conditions.sql`:

```sql
-- Floor conditions: minimum-track constraints that raise but never force Track 4
ALTER TABLE tools ADD COLUMN IF NOT EXISTS floor_conditions JSONB DEFAULT '[]';
```

- [ ] **Step 6: Persist floors in `backend/src/routes/intake.js`.** Change `computeFromAnswers` to delegate to `computeTrack` (import it; drop the now-unused individual imports if nothing else uses them):

```js
import { computeTrack } from "../scoring.js";

function computeFromAnswers(answers, artifactType) {
  if (!answers || typeof answers !== "object") return null;
  const r = computeTrack(answers, artifactType);
  return { scores: r.scores, escalations: r.escalations, floors: r.floors, pct: r.weightedPct, track: r.track };
}
```

In all three INSERT/UPDATE statements (draft POST, draft PUT, submit POST — both branches), add `floor_conditions` alongside `escalation_conditions`, bound to `JSON.stringify(computed?.floors || [])` (drafts) / `JSON.stringify(computed.floors)` (submit). Renumber the positional parameters carefully — each statement gains one column.

- [ ] **Step 7: Sidebar display** in `frontend/src/components/IntakeForm.jsx`, directly below the escalations block (after line ~600):

```jsx
              {result.floors?.length > 0 && result.escalations.length === 0 && (
                <div style={{ marginTop: 10 }}>
                  {result.floors.map((f, i) => (
                    <div key={i} style={{ fontSize: 10, color: TRACK_COLORS[3], marginBottom: 3, display: "flex", alignItems: "center", gap: 4 }}>
                      <AlertTriangle size={10} /> Minimum Track {f.track}: {f.reason}
                    </div>
                  ))}
                </div>
              )}
```

- [ ] **Step 8: Run + fix collateral.** `npm test` — the existing escalation-matrix tests that assert FERPA+public-auth escalates will fail; update them to the new semantics (escalation only when no SSO; floor when SSO). Verify every changed expectation by hand against the new rules. Then `npm run build` in frontend.

- [ ] **Step 9: Commit**: `git commit -am "feat: split FERPA escalation, add Track 3 floor for SSO-protected deployments (FW-06)"`

---

### Task 3: FW-05 — Artifact-type gaming guard (applicable profiles)

**Files:**
- Modify: `backend/src/scoring.js`
- Modify: `frontend/src/constants.js`
- Modify: `backend/src/scoring.test.js`

**Interfaces:**
- Produces: `applicableProfiles(answers, declaredType)` → string[] (exported from scoring.js).
- Produces: `computeEffectivePercentage(scores, answers, declaredType)` → `{ pct, profile }` (exported).
- `computeTrack` routes on the max percentage across applicable profiles and returns `profileUsed`.
- Rationale: profiles are derived from the answers (deployment surface, AI use), not just self-declared q1, so switching q1 alone can never lower the track.

- [ ] **Step 1: Failing tests** (append to `scoring.test.js`; import the two new functions):

```js
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
```

- [ ] **Step 2: Run — verify failure** (`applicableProfiles` not exported; ai-agent currently routes lower).

- [ ] **Step 3: Implement in `backend/src/scoring.js`** (after `computeWeightedPercentage`):

```js
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
```

Update `computeTrack` to use it:

```js
export function computeTrack(answers, artifactType) {
  const scores = computeDimensionScores(answers);
  const escalations = checkEscalations(answers);
  const floors = checkFloors(answers);
  const { pct, profile } = computeEffectivePercentage(scores, answers, artifactType || answers.q1 || "other");
  const floorTrack = floors.reduce((m, f) => Math.max(m, f.track), 1);
  const track = routeToTrack(pct, escalations.length > 0, floorTrack);
  return { track, scores, escalations, floors, weightedPct: pct, profileUsed: profile };
}
```

- [ ] **Step 4: Mirror in `frontend/src/constants.js`.** Add private `applicableProfiles` (same body, using `WEIGHT_MATRIX` keys via `Object.keys(WEIGHT_MATRIX)` in place of `VALID_ARTIFACT_TYPES`), and update `computeTrack` to iterate profiles, keep the best, and return `weights` of the winning profile so the sidebar `dims[k]x{weights[k]}` display reflects what actually routed:

```js
export function computeTrack(a) {
  const d = computeDimensionScores(a);
  const esc = checkEscalations(a);
  const floors = checkFloors(a);
  let best = null;
  for (const profile of applicableProfiles(a, a.q1 || "other")) {
    const w = WEIGHT_MATRIX[profile] || WEIGHT_MATRIX["other"];
    let total = 0, max = 0;
    for (const k of Object.keys(d)) { total += d[k] * (w[k] || 0); max += 3 * (w[k] || 0); }
    const pct = max > 0 ? total / max : 0;
    if (best === null || pct > best.pct) best = { pct, total, max, w, profile };
  }
  const floorTrack = floors.reduce((m, f) => Math.max(m, f.track), 1);
  let track;
  if (esc.length > 0 || best.pct >= 0.65) track = 4;
  else if (best.pct >= 0.42) track = 3;
  else if (best.pct >= 0.22) track = 2;
  else track = 1;
  if (esc.length === 0) track = Math.max(track, floorTrack);
  return { track, total: best.total, max: best.max, pct: best.pct, dims: d, weights: best.w, escalations: esc, floors, profileUsed: best.profile };
}
```

- [ ] **Step 5: Run + fix collateral.** Existing `computeTrack` tests whose answer sets have `q5` public/campus surfaces or AI classification may now route on a different profile; recompute each changed expectation by hand (score vector × candidate profiles, take max) before updating it. `npm test` PASS, `npm run build` PASS.

- [ ] **Step 6: Add a parity spot-check** to `scoring.test.js`:

```js
import { computeTrack as feComputeTrack } from "../../frontend/src/constants.js";

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
```

- [ ] **Step 7: Commit**: `git commit -am "feat: derive applicable weight profiles from answers to close artifact-type gaming (FW-05)"`

---

### Task 4: FW-04 — Always ask q19; comprehension measured for every tool

**Files:**
- Modify: `frontend/src/components/IntakeForm.jsx` (move q19 out of the `showAI` block; visibleQuestions)
- Modify: `backend/src/scoring.test.js` (comprehension expectations for non-AI tools)

**Interfaces:**
- q19 renders for every submission in a new always-visible section; q20/q21 stay gated behind `showAI`.
- `visibleQuestions` includes `q19` unconditionally.
- Backend scoring is unchanged: comprehension 3 for a missing/short q19 is now a real signal (the builder was asked and did not explain), not a phantom.

- [ ] **Step 1: Move the question.** In `IntakeForm.jsx`, delete the `<Q n={19} ...>` block from inside the `{showAI && <>...}` fragment (lines ~531-533) and insert it after the `<Q n={18} ...>` block (line ~527), wrapped in its own section divider:

```jsx
          <SectionDivider num="5" title="Comprehension" sub="Every tool answers this — AI-built or not." />
          <Q n={19} label="Explain in plain language what the tool does and what happens when it fails." req routing="Builder Comprehension check. Answered for every tool; a thorough explanation lowers the Comprehension risk score." answered={isAnswered(a,"q19")} hint={FIELD_HINTS.q19} error={fieldErrors.q19}>
            <textarea className="text-area" value={a.q19 || ""} onChange={e=>s("q19",e.target.value)} placeholder="Walk a non-technical reviewer through the tool..." style={{ minHeight: 100 }} aria-labelledby="q19-label" />
          </Q>
```

Renumber the AI section divider that follows from `num="5"` to `num="6"`.

- [ ] **Step 2: Update `visibleQuestions`** (lines ~310-316):

```js
  const visibleQuestions = useMemo(() => {
    const qs = ["q1","q2","q3","q4","q5","q6","q7","q8","q9"];
    if (showData) qs.push("q10","q11","q12","q13");
    qs.push("q14","q15","q16","q17","q18","q19");
    if (showAI) qs.push("q20","q21");
    return qs;
  }, [showData, showAI]);
```

- [ ] **Step 3: Backend test documenting the intent** (append to `scoring.test.js`):

```js
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
```

- [ ] **Step 4: Verify**: `npm test` PASS, `npm run build` PASS. (q19 becomes REQUIRED in Task 5.)

- [ ] **Step 5: Commit**: `git commit -am "feat: ask q19 comprehension question for every tool, not only AI-classified (FW-04)"`

---

### Task 5: FW-03 — Enforce the phantom-required questions; backend intake validation

**Files:**
- Modify: `backend/src/validation.js` (add `validateIntakeAnswers`)
- Modify: `backend/src/routes/intake.js` (enforce on submit, both branches)
- Modify: `frontend/src/components/IntakeForm.jsx` (conditional REQUIRED_QUESTIONS)
- Modify: `backend/src/routes/intake.test.js` (new schema tests)

**Interfaces:**
- Produces: `validateIntakeAnswers(answers)` → `{ ok: true } | { ok: false, errors: string[] }` exported from `validation.js`. Applied ONLY on submit (drafts stay lenient).
- Frontend: `REQUIRED_QUESTIONS` constant becomes `requiredQuestions(a)` function.
- Required set: q1-q7, q9, q14-q18, q19 always; q10, q11, q12 when `q9 === "yes"`; q20, q21 when AI-classified (`q1 === "ai-agent"` or q12 is one of `approved-dpa|unknown-dpa|no-dpa`). Escalation-relevant enums validated so answers like `q12: "garbage"` cannot dodge `checkEscalations`.

- [ ] **Step 1: Failing tests** in `backend/src/routes/intake.test.js` (follow the conventions in `review.test.js`; import `validateIntakeAnswers` from `../validation.js`):

```js
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
```

- [ ] **Step 2: Run — FAIL** (function does not exist).

- [ ] **Step 3: Implement** in `backend/src/validation.js`:

```js
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
  q20: z.string().optional(),
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
```

- [ ] **Step 4: Enforce on submit** in `backend/src/routes/intake.js`. Import `validateIntakeAnswers` from `../validation.js`. In `POST /` (submit), in BOTH branches, after resolving `answers`/`intakeAnswers` and before computing, add:

```js
    const validation = validateIntakeAnswers(answers);   // draft branch: `answers`; direct branch: `intakeAnswers`
    if (!validation.ok) {
      return res.status(400).json({ error: "Intake answers incomplete", details: validation.errors });
    }
```

Do NOT add this to the `/draft` routes.

- [ ] **Step 5: Frontend required set.** In `IntakeForm.jsx`, replace the `REQUIRED_QUESTIONS` constant (line 14) with:

```js
// Required questions are conditional: data questions when q9=yes, AI questions when AI-classified.
function requiredQuestions(a) {
  const req = ["q1","q2","q3","q4","q5","q6","q7","q9","q14","q15","q16","q17","q18","q19"];
  if (a.q9 === "yes") req.push("q10","q11","q12");
  const showAI = a.q1 === "ai-agent" || ["approved-dpa","unknown-dpa","no-dpa"].includes(a.q12);
  if (showAI) req.push("q20","q21");
  return req;
}
```

In `handleSubmit` (line ~346), change `REQUIRED_QUESTIONS.filter(...)` to `requiredQuestions(a).filter(...)`. Add `error={fieldErrors.q10}` etc. to the `<Q>` components for q10, q11, q12, q20, q21 (q19 got its `error` prop in Task 4's block — verify it is present).

- [ ] **Step 6: Verify**: `npm test` PASS; `npm run build` PASS.

- [ ] **Step 7: Commit**: `git commit -am "feat: enforce conditional required questions and backend intake validation (FW-03)"`

---

### Task 6: FW-12 — Fix the intake form's false escalation warnings

**Files:**
- Modify: `frontend/src/components/IntakeForm.jsx:463-464,512`

**Interfaces:** Warnings must state only rules that `checkEscalations`/`checkFloors` actually implement (post Task 2).

- [ ] **Step 1: q5 warning** (line ~463-464). Replace the `esc={...}` prop on `<Q n={5}>` with:

```jsx
            esc={(a.q10||[]).includes("ferpa") && a.q5 === "public-noauth" ? "FERPA + public (no auth) = automatic Track 4"
              : (a.q10||[]).includes("ferpa") && a.q5 === "public-auth" && a.q6 !== "sso" ? "FERPA + public without campus SSO = automatic Track 4"
              : (a.q10||[]).includes("ferpa") && a.q5 === "public-auth" && a.q6 === "sso" ? "FERPA + internet-reachable = minimum Track 3"
              : null}
```

- [ ] **Step 2: q15 warning** (line ~512). Replace `"No version control — blocks approval at Track 2+"` with `"No version control = automatic Track 4"`.

- [ ] **Step 3: Verify** `npm run build`; manually cross-check each warning string against `checkEscalations`/`checkFloors` in `scoring.js`.

- [ ] **Step 4: Commit**: `git commit -am "fix: intake escalation warnings state the real routing rules (FW-12)"`

---

### Task 7: FW-08 — Enforce documented track-override constraints

**Files:**
- Modify: `backend/src/routes/review.js:74-111`
- Modify: `backend/src/routes/review.test.js`

**Interfaces:**
- Produces: `canOverrideTrack({ oldTrack, newTrack, escalations, role })` → `{ allowed: boolean, reason?: string }` exported from `review.js` (pure, testable).
- Documented rules (track-routing.md:194): escalation to Track 4 always allowed; de-escalation below Track 4 is blocked for everyone while escalation conditions apply; de-escalation FROM Track 4 additionally requires admin.

- [ ] **Step 1: Failing tests** (append to `review.test.js`; import `canOverrideTrack` from `./review.js` — if importing the router file pulls in DB side effects, move the function to `backend/src/review-rules.js` and import from both places; check `review.js` top-level for side effects first: `pool` import alone is fine, `pool.query` at module top-level is not):

```js
describe("canOverrideTrack (FW-08)", () => {
  it("always allows escalation to Track 4", () => {
    assert.equal(canOverrideTrack({ oldTrack: 2, newTrack: 4, escalations: [], role: "reviewer" }).allowed, true);
    assert.equal(canOverrideTrack({ oldTrack: 1, newTrack: 4, escalations: ["x"], role: "reviewer" }).allowed, true);
  });
  it("blocks de-escalation below 4 while escalations apply, for any role", () => {
    assert.equal(canOverrideTrack({ oldTrack: 4, newTrack: 3, escalations: ["Regulated data"], role: "admin" }).allowed, false);
    assert.equal(canOverrideTrack({ oldTrack: 4, newTrack: 1, escalations: ["Regulated data"], role: "reviewer" }).allowed, false);
  });
  it("de-escalation from Track 4 without escalations requires admin", () => {
    assert.equal(canOverrideTrack({ oldTrack: 4, newTrack: 3, escalations: [], role: "reviewer" }).allowed, false);
    assert.equal(canOverrideTrack({ oldTrack: 4, newTrack: 3, escalations: [], role: "admin" }).allowed, true);
  });
  it("reviewers may adjust between Tracks 1-3 when no escalations apply", () => {
    assert.equal(canOverrideTrack({ oldTrack: 3, newTrack: 2, escalations: [], role: "reviewer" }).allowed, true);
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** in `backend/src/routes/review.js` (top of file, after imports):

```js
/**
 * Documented override constraints (docs/framework/track-routing.md):
 * escalation to Track 4 is always permitted; de-escalation below Track 4 is
 * never permitted while an escalation condition applies; de-escalation from
 * Track 4 is admin-only.
 */
export function canOverrideTrack({ oldTrack, newTrack, escalations, role }) {
  if (newTrack === 4) return { allowed: true };
  if ((escalations || []).length > 0 && newTrack < 4) {
    return { allowed: false, reason: "Escalation conditions still apply; the tool cannot be routed below Track 4." };
  }
  if (oldTrack === 4 && newTrack < 4 && role !== "admin") {
    return { allowed: false, reason: "De-escalation from Track 4 requires an admin." };
  }
  return { allowed: true };
}
```

In the `track-override` handler, after `FOR UPDATE` fetch of the tool and before the UPDATE:

```js
    const escalations = Array.isArray(tool.escalation_conditions) ? tool.escalation_conditions
      : JSON.parse(tool.escalation_conditions || "[]");
    const check = canOverrideTrack({ oldTrack: tool.track, newTrack, escalations, role: req.user.role });
    if (!check.allowed) { res.status(403).json({ error: check.reason }); return null; }
```

(`pg` returns JSONB as a parsed value, so the `Array.isArray` branch is the normal path; the `JSON.parse` fallback covers test doubles.)

- [ ] **Step 4: Verify**: `npm test` PASS.

- [ ] **Step 5: Commit**: `git commit -am "fix: enforce documented track-override constraints (FW-08)"`

---

### Task 8: FW-07 — Track 2 self-certification records a real attestation

**Files:**
- Modify: `backend/src/validation.js` (add `selfCertifySchema`)
- Modify: `backend/src/routes/review.js:172-220`
- Modify: `frontend/src/api.js:264-267`
- Modify: `frontend/src/components/ReviewPanel.jsx:55-64,127-140`
- Modify: `backend/src/routes/review.test.js`

**Interfaces:**
- Produces: `selfCertifySchema` = `{ attestation: string >= 20 chars, confirmFindingsReviewed: literal true, confirmEscalationsUnderstood: literal true }`.
- Route: only the tool OWNER may self-certify (any role — fixes the provenance hole where reviewers could "self"-certify others' tools).
- Attestation stored in `review_notes.body` and `metadata`.
- `selfCertify(toolId, payload)` in api.js.

- [ ] **Step 1: Failing schema tests** in `review.test.js`:

```js
describe("selfCertifySchema (FW-07)", () => {
  const valid = {
    attestation: "I reviewed all pipeline findings and accept responsibility for operating this tool.",
    confirmFindingsReviewed: true,
    confirmEscalationsUnderstood: true,
  };
  it("accepts a complete attestation", () => {
    assert.ok(selfCertifySchema.safeParse(valid).success);
  });
  it("rejects a short attestation", () => {
    assert.equal(selfCertifySchema.safeParse({ ...valid, attestation: "ok" }).success, false);
  });
  it("rejects unchecked confirmations", () => {
    assert.equal(selfCertifySchema.safeParse({ ...valid, confirmFindingsReviewed: false }).success, false);
    assert.equal(selfCertifySchema.safeParse({ ...valid, confirmEscalationsUnderstood: false }).success, false);
  });
  it("rejects an empty body", () => {
    assert.equal(selfCertifySchema.safeParse({}).success, false);
  });
});
```

- [ ] **Step 2: Run — FAIL.** Then implement in `validation.js`:

```js
export const selfCertifySchema = z.object({
  attestation: z.string().min(20, "attestation must describe what was reviewed (min 20 chars)").max(4000),
  confirmFindingsReviewed: z.literal(true),
  confirmEscalationsUnderstood: z.literal(true),
});
```

- [ ] **Step 3: Route changes** in `review.js`. Add `selfCertifySchema` to the validation import. Change the route signature and body:

```js
router.post("/:toolId/self-certify", validate(selfCertifySchema), async (req, res) => {
  const { toolId } = req.params;
  const { attestation } = req.validated;
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
```

Replace the ownership guard (lines ~179-181) with owner-only for every role:

```js
    if (tool.owner_id !== req.user.userId) {
      res.status(403).json({ error: "Only the tool owner can self-certify" }); return null;
    }
```

Replace the fixed-string note insert with:

```js
    await client.query(
      `INSERT INTO review_notes (tool_id, author_id, body, note_type, metadata)
       VALUES ($1, $2, $3, 'status_change', $4)`,
      [toolId, req.user.userId, `Self-certification: ${attestation}`,
       JSON.stringify({ from: "under_review", to: "active", method: "self_certify",
         attestation, confirmFindingsReviewed: true, confirmEscalationsUnderstood: true })]
    );
```

Add `details: { attestation: attestation.slice(0, 500) }` to the `logAudit` call.

- [ ] **Step 4: Frontend.** `api.js`:

```js
export async function selfCertify(toolId, payload) {
  const res = await request(`/review/${toolId}/self-certify`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.json();
}
```

`ReviewPanel.jsx`: add state and replace the self-certify block:

```jsx
  const [attestation, setAttestation] = useState("");
  const [certChecks, setCertChecks] = useState({ findings: false, escalations: false });
```

```jsx
        {canSelfCertify && (
          <div style={{ padding: "0 16px" }}>
            <div className="info-banner" style={{ marginBottom: 8 }}>
              <div>
                <strong>Track 2 — Self-Certification</strong>
                <div style={{ fontSize: 12, marginTop: 4, color: C.textMid }}>
                  Review the pipeline findings, confirm the statements below, and describe what you reviewed. This attestation is stored on the audit record.
                </div>
              </div>
            </div>
            <label style={{ display: "flex", gap: 8, fontSize: 12, marginBottom: 6, alignItems: "flex-start" }}>
              <input type="checkbox" checked={certChecks.findings} onChange={e => setCertChecks(p => ({ ...p, findings: e.target.checked }))} style={{ marginTop: 2 }} />
              I have read every finding in the pipeline report for this tool.
            </label>
            <label style={{ display: "flex", gap: 8, fontSize: 12, marginBottom: 8, alignItems: "flex-start" }}>
              <input type="checkbox" checked={certChecks.escalations} onChange={e => setCertChecks(p => ({ ...p, escalations: e.target.checked }))} style={{ marginTop: 2 }} />
              I understand the escalation conditions and confirm none apply beyond what is recorded.
            </label>
            <label htmlFor="self-cert-attestation" style={{ display: "block", fontSize: 11, fontWeight: 600, color: C.textMid, marginBottom: 3 }}>Attestation (what did you review, what will you monitor?)</label>
            <textarea id="self-cert-attestation" value={attestation} onChange={e => setAttestation(e.target.value)}
              placeholder="e.g. Reviewed all 12 findings; the two warnings about rate limiting are accepted risks because..."
              style={{ width: "100%", minHeight: 60, padding: 8, borderRadius: 6, border: `1px solid ${C.border}`,
                background: C.bg, color: C.text, fontSize: 12, fontFamily: "'DM Sans', sans-serif", resize: "vertical", boxSizing: "border-box", marginBottom: 8 }} />
            <Btn onClick={handleSelfCertify} disabled={submitting || !certChecks.findings || !certChecks.escalations || attestation.trim().length < 20}>
              Self-Certify &amp; Activate
            </Btn>
          </div>
        )}
```

Update the handler:

```js
  async function handleSelfCertify() {
    setSubmitting(true);
    try {
      const result = await selfCertify(tool.id, {
        attestation: attestation.trim(),
        confirmFindingsReviewed: certChecks.findings,
        confirmEscalationsUnderstood: certChecks.escalations,
      });
      toast.success("Self-certification complete — tool is now active");
      loadNotes();
      onUpdate?.(result.tool);
    } catch (err) { toast.error(err.message); }
    finally { setSubmitting(false); }
  }
```

- [ ] **Step 5: Verify**: `npm test` PASS, `npm run build` PASS.

- [ ] **Step 6: Commit**: `git commit -am "feat: self-certification requires attestation and confirmations (FW-07)"`

---

### Task 9: FW-09 — Feed the codebase bundle to the HECVAT pass

**Files:**
- Modify: `backend/src/orchestrator/direct-api.js:490` (Agent 4 call)
- Modify: `backend/src/agents/documentation/runner.js:202,241`

**Interfaces:**
- `runDocGenerationParallel(codebasePath, runDir, outputDir, opts)` gains `opts.codeBundle` (string). HECVAT `runDirectPass` receives it instead of `""`.

- [ ] **Step 1:** In `orchestrator/direct-api.js`, change the Agent 4 invocation (line ~490):

```js
  const documentation = await runDocGenerationParallel(codebasePath, runDir, docsDir, { ...agentOpts, codeBundle });
```

- [ ] **Step 2:** In `documentation/runner.js` line ~241, change the HECVAT call:

```js
      const result = await runDirectPass(DIRECT_MODELS.pass5, hecvatFullPrompt, opts.codeBundle || "", outputDir, {
```

- [ ] **Step 3: Verify**: `node --check src/orchestrator/direct-api.js && node --check src/agents/documentation/runner.js` from `backend/`, then `npm test`.

- [ ] **Step 4: Commit**: `git commit -am "fix: HECVAT pass receives the codebase bundle instead of an empty string (FW-09)"`

---

### Task 10: FW-10 — Synthesis fallback, output shape validation, JSON-aware truncation

**Files:**
- Modify: `backend/src/orchestrator/direct-api.js` (`runAgentDirect`, lines ~153-292)

**Interfaces:**
- Produces (module-private): `deterministicMerge(reports, passKeys)` → synthesis-shaped object with `metadata.synthesis_failed: true`; `synthesisShapeOk(obj)` → boolean.
- Behavior: if the Claude synthesis CLI fails after retries OR its output fails the shape check, the pipeline continues with the deterministic merge instead of failing the run. Truncation for synthesis input drops whole findings, not mid-JSON characters.

- [ ] **Step 1: Add the helpers** near the top of `orchestrator/direct-api.js` (after `summarizeFindings`):

```js
/**
 * Fallback when the synthesis model is unavailable or returns unusable output:
 * union pass findings, dedupe by normalized title, recompute convergence.
 * No dispute resolution happens — the report says so explicitly.
 */
function deterministicMerge(reports, passKeys) {
  const norm = t => (t || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 60);
  const byKey = new Map();
  for (const r of Object.values(reports)) {
    for (const f of r.parsed?.findings || []) {
      const k = norm(f.title || f.finding || f.detail);
      if (!k) continue;
      if (!byKey.has(k)) byKey.set(k, { ...f, reportedBy: [r.name], convergenceCount: 1 });
      else {
        const e = byKey.get(k);
        e.reportedBy.push(r.name);
        e.convergenceCount++;
      }
    }
  }
  const findings = [...byKey.values()].map(f => ({
    ...f, confidence: f.convergenceCount >= 3 ? "confirmed" : "potential",
  }));
  return {
    findings,
    summary: "Synthesis model unavailable — deterministic merge of pass findings. No dispute resolution or hallucination verification was performed; treat potential findings with extra caution.",
    disputes: [],
    convergenceStats: {
      confirmed: findings.filter(f => f.confidence === "confirmed").length,
      potential: findings.filter(f => f.confidence === "potential").length,
      resolved: 0, needs_human_review: 0,
    },
    metadata: {
      synthesis_failed: true,
      models_completed: Object.keys(reports).length,
      models_total: passKeys.length,
    },
  };
}

function synthesisShapeOk(obj) {
  return !!obj && typeof obj === "object" && Array.isArray(obj.findings);
}
```

- [ ] **Step 2: JSON-aware truncation.** Inside the `synthesisInput` builder, replace the parsed-report truncation branch (`content = content.slice(0, MAX_PASS_CHARS) + '…(truncated)';`) with:

```js
      if (content.length > MAX_PASS_CHARS && Array.isArray(trimmed.findings)) {
        // Drop whole findings from the tail rather than slicing mid-JSON,
        // so the synthesizer never counts convergence over amputated objects.
        while (trimmed.findings.length > 5 && JSON.stringify(trimmed).length > MAX_PASS_CHARS) {
          trimmed.findings.pop();
        }
        trimmed.findingsTruncatedForSynthesis = true;
        content = JSON.stringify(trimmed);
        pLog.info("Trimmed findings for synthesis input", { pass: key, kept: trimmed.findings.length });
      }
      if (content.length > MAX_PASS_CHARS) {
        pLog.info("Truncating verbose pass for synthesis", { pass: key, original: content.length, truncated: MAX_PASS_CHARS });
        content = content.slice(0, MAX_PASS_CHARS) + '…(truncated)';
      }
```

- [ ] **Step 3: Wrap synthesis with fallback.** Replace the block from `const synthesisResult = await runCLIWithRetry("claude", ...)` through `let synthesized = extractJSON(synthesisResult.output);` with:

```js
  let synthesisResult = null;
  let synthesized = null;
  let synthesisFailed = false;
  try {
    synthesisResult = await runCLIWithRetry("claude", fullSynthesisPrompt, codebasePath, outputDir, {
      runId, signal, maxRetries: 1, retryDelayMs: 10000, onOutput: synthOnOutput,
    });
    synthesized = extractJSON(synthesisResult.output);
    if (!synthesisShapeOk(synthesized)) {
      pLog.warn("Synthesis output failed shape check; using deterministic merge", { hasOutput: !!synthesisResult.output });
      if (synthesisResult.output) writeFileSync(join(outputDir, "synthesis_raw.txt"), synthesisResult.output);
      synthesized = null;
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    pLog.error("Synthesis CLI failed; falling back to deterministic merge", { error: err.message });
    synthesisFailed = true;
  }
  if (!synthesized) {
    synthesized = deterministicMerge(reports, passKeys);
    synthesisFailed = true;
    emit({ type: "pass_failed", agent: agentDef.name, pass: "synthesis", model: "Claude Opus 4.6",
      error: "Synthesis unavailable — deterministic merge used", errorCategory: "synthesis_fallback" });
  }
```

Then adjust the code that follows: the `if (synthesized) { ... } else { writeFileSync(...synthesis_raw...) }` structure collapses — `synthesized` is now always set, so drop the else branch (raw output is already written above when relevant). Guard the stack deep dive with `&& !synthesisFailed` (dispute-resolution work on top of a fallback merge is not meaningful). The final return's `raw:` becomes `synthesisResult?.output || null`, and add `synthesisFailed` to the returned object.

- [ ] **Step 4: Verify**: `node --check src/orchestrator/direct-api.js`; `npm test` PASS.

- [ ] **Step 5: Commit**: `git commit -am "feat: synthesis fallback merge, shape validation, and JSON-aware truncation (FW-10)"`

---

### Task 11: FW-11 — Coverage honesty for truncated bundles; report banners

**Files:**
- Modify: `backend/src/orchestrator/direct-api.js` (pass bundle info into agents; stamp metadata)
- Modify: `frontend/src/components/Report.jsx` (banner)

**Interfaces:**
- `runAgentDirect(..., opts)` gains `opts.bundleInfo` = `{ truncated, totalFiles, includedFiles, excludedCount }`.
- Every synthesis object gains `metadata.coverage` = `{ truncated, totalFiles, includedFiles, excludedCount, coveragePct }`.
- Pipeline result gains a top-level `bundle` summary; the run summary JSON (already persisted by queue.js) therefore carries it. Task 12 consumes `result.bundle.truncated`.

- [ ] **Step 1: Build bundleInfo** in `runDirectApiPipeline` after the bundle manifest write:

```js
  const bundleInfo = {
    truncated: bundle.truncated,
    totalFiles: bundle.totalFiles,
    includedFiles: bundle.manifest.length,
    excludedCount: bundle.excluded.length,
    coveragePct: bundle.totalFiles > 0 ? Math.round((bundle.manifest.length / bundle.totalFiles) * 100) : 100,
  };
```

Add `bundleInfo` to `agentOpts` (`const agentOpts = { runId, signal, previousFindings, bundleInfo };`) and add `bundle: bundleInfo` to the final `result` object.

- [ ] **Step 2: Stamp synthesis metadata** in `runAgentDirect`, right after the fallback block from Task 10 (where `synthesized` is guaranteed set):

```js
  synthesized.metadata = synthesized.metadata || {};
  if (passCount < passKeys.length) {
    synthesized.metadata.partial_analysis = true;
    synthesized.metadata.models_completed = passCount;
    synthesized.metadata.models_total = passKeys.length;
  }
  if (opts.bundleInfo?.truncated) {
    synthesized.metadata.coverage = { ...opts.bundleInfo };
  }
  writeFileSync(join(outputDir, "synthesis.json"), JSON.stringify(synthesized, null, 2));
```

Remove the older duplicate `if (passCount < passKeys.length && synthesized.metadata)` stanza this supersedes.

- [ ] **Step 3: Report banner** in `frontend/src/components/Report.jsx`. After the `<PageHeader>` closing tag (line ~124), insert:

```jsx
      {(() => {
        const agentsData = report?.agents || {};
        const metas = ["codeAnalysis", "accessibility", "qaAnalysis"]
          .map(k => agentsData[k]?.synthesis?.metadata).filter(Boolean);
        const coverage = metas.find(m => m.coverage?.truncated)?.coverage;
        const partial = metas.find(m => m.partial_analysis);
        const synthFailed = metas.find(m => m.synthesis_failed);
        if (!coverage && !partial && !synthFailed) return null;
        return (
          <div className="info-banner" role="status" style={{ marginBottom: 16, borderColor: C.warning }}>
            <strong>Analysis coverage caveats</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13 }}>
              {coverage && <li>Codebase exceeded the bundle budget: {coverage.includedFiles} of {coverage.totalFiles} files ({coverage.coveragePct}%) were visible to API passes 2-5. Findings in excluded files can only come from pass 1 and cannot reach the confirmed tier.</li>}
              {partial && <li>Not all model passes completed ({partial.models_completed}/{partial.models_total}); convergence confidence is reduced.</li>}
              {synthFailed && <li>Synthesis model was unavailable; findings are a deterministic merge without dispute resolution.</li>}
            </ul>
          </div>
        );
      })()}
```

If `Report.jsx` has no `info-banner` CSS class in scope, reuse the same pattern `ReviewPanel.jsx` uses (it does — keep the class).

- [ ] **Step 4: Verify**: backend `node --check` + `npm test`; frontend `npm run build`.

- [ ] **Step 5: Commit**: `git commit -am "feat: surface bundle truncation and partial-analysis coverage on reports (FW-11)"`

---

### Task 12: FW-02 + improvement 5 — Intake-vs-code contradiction check and Track 1 activation gate (migration 016)

**Files:**
- Create: `backend/migrations/016_activation_gate.sql`
- Create: `backend/src/pipeline/activation-gate.js`
- Create: `backend/src/pipeline/activation-gate.test.js`
- Modify: `backend/src/pipeline/queue.js` (completion block from Task 1)

**Interfaces:**
- Produces: `findContradictions(answers, codeSynthesis)` → array of `{ question, answered, observed, evidence, detail }`.
- Produces: `evaluateActivationGate({ track, answers, codeSynthesis, partial, truncated })` → `{ activate, blocked, reasons: string[], contradictions }`. `activate` is true only for Track 1 with zero blocking reasons; for Tracks 2-4 both `activate` and `blocked` are false (gate does not apply).
- Blocking reasons for Track 1: any contradiction; any confirmed critical finding; partial analysis; truncated bundle.
- Stored in `pipeline_runs.activation_gate JSONB`; blocked runs set the tool to `under_review` and notify reviewers.

- [ ] **Step 1: Migration** `backend/migrations/016_activation_gate.sql`:

```sql
-- Result of the Track 1 auto-activation gate (contradictions, criticals, coverage)
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS activation_gate JSONB;
```

- [ ] **Step 2: Failing unit tests** `backend/src/pipeline/activation-gate.test.js`:

```js
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
```

- [ ] **Step 3: Run — FAIL.** Implement `backend/src/pipeline/activation-gate.js`:

```js
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
  const applies = track === 1;
  return {
    activate: applies && reasons.length === 0,
    blocked: applies && reasons.length > 0,
    reasons,
    contradictions,
  };
}
```

- [ ] **Step 4: Wire into `queue.js`.** Import at top: `import { evaluateActivationGate } from "./activation-gate.js";`. In the completion block (post Task 1, where `freshTool` and `result` exist), replace `const newStatus = effectiveTrack === 1 ? "active" : "under_review";` with:

```js
    const intakeAnswers = typeof freshTool?.intake_answers === "string"
      ? JSON.parse(freshTool.intake_answers) : (freshTool?.intake_answers || null);
    const anyPartial = ["codeAnalysis", "accessibility", "qaAnalysis"].some(k => result.agents[k]?.partial);
    const gate = evaluateActivationGate({
      track: effectiveTrack,
      answers: intakeAnswers,
      codeSynthesis: result.agents.codeAnalysis?.synthesis || null,
      partial: anyPartial,
      truncated: !!result.bundle?.truncated,
    });
    const newStatus = gate.activate ? "active" : "under_review";
```

In the completion transaction, persist the gate on the run:

```js
      await client.query(
        `UPDATE pipeline_runs SET status = 'completed', output_dir = $1, summary = $2, activation_gate = $3, completed_at = NOW() WHERE id = $4`,
        [result.outputDir, JSON.stringify(result.agents), JSON.stringify(gate), runId]
      );
```

Update the owner notification title logic: Track 1 blocked runs should read differently:

```js
      const pipelineTitle = effectiveTrack === 1 && gate.activate
        ? `"${completedTool.name}" pipeline complete — auto-activated`
        : effectiveTrack === 1
          ? `"${completedTool.name}" pipeline complete — auto-activation blocked, review required`
          : `"${completedTool.name}" pipeline complete — awaiting review`;
```

And extend the reviewer-notification condition so blocked Track 1 tools page reviewers too (`if (newStatus === "under_review")` already covers it since blocked runs set `under_review` — verify, and change the `reviewTitle` to include the reason when blocked):

```js
        const reviewTitle = gate.blocked
          ? `"${completedTool.name}" auto-activation blocked: ${gate.reasons.join("; ")}`
          : `"${completedTool.name}" needs review (Track ${effectiveTrack})`;
```

- [ ] **Step 5: Verify**: `node --test src/pipeline/activation-gate.test.js` PASS, then full `npm test`.

- [ ] **Step 6: Commit**: `git commit -am "feat: intake-vs-code contradiction detector gates Track 1 auto-activation (FW-02)"`

---

### Task 13: Improvement 18 — Real cost from captured token usage (migration 017)

**Files:**
- Create: `backend/migrations/017_pass_tokens.sql`
- Modify: `backend/src/orchestrator/direct-api.js` (emit usage on pass_complete)
- Modify: `backend/src/pipeline/queue.js` (persist tokens; token-based cost)

**Interfaces:**
- `pass_results.prompt_tokens INTEGER`, `pass_results.completion_tokens INTEGER`.
- `pass_complete` events gain `promptTokens`/`completionTokens` (direct-API passes only; CLI passes emit none and fall back to flat cost).
- `computePipelineMetrics` uses `MODEL_TOKEN_RATES` (USD per 1M tokens) when tokens exist, else the flat `MODEL_COST_USD` constant.

- [ ] **Step 1: Migration** `backend/migrations/017_pass_tokens.sql`:

```sql
-- Actual token usage per pass (direct-API passes; CLI passes remain NULL)
ALTER TABLE pass_results ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER;
ALTER TABLE pass_results ADD COLUMN IF NOT EXISTS completion_tokens INTEGER;
```

- [ ] **Step 2: Emit usage.** In `orchestrator/direct-api.js`, direct-API branch of `runAgentDirect`, extend the `pass_complete` emit:

```js
        emit({ type: "pass_complete", agent: agentDef.name, pass: key, model: pass.name,
          elapsed: parseFloat(elapsed), jsonParsed: !!directResult.parsed, outputBytes,
          promptTokens: directResult.usage?.prompt_tokens ?? null,
          completionTokens: directResult.usage?.completion_tokens ?? null });
```

- [ ] **Step 3: Persist.** In `queue.js` `pass_complete` handler, change the UPDATE:

```js
        pool.query(
          `UPDATE pass_results SET status = 'completed', elapsed_seconds = $1, completed_at = NOW(),
             json_parsed = $2, output_bytes = $3, prompt_tokens = $4, completion_tokens = $5
           WHERE run_id = $6 AND agent_name = $7 AND pass_key = $8 AND status = 'running'`,
          [event.elapsed || 0, event.jsonParsed !== false, event.outputBytes || 0,
           event.promptTokens ?? null, event.completionTokens ?? null,
           runId, event.agent, event.pass]
        ).catch(err => log.error("pass_complete DB update failed", { runId, error: err.message }));
```

- [ ] **Step 4: Token-based cost.** In `queue.js`, below `MODEL_COST_USD`, add:

```js
/**
 * USD per 1M tokens (input, output) for direct-API models.
 * Approximations from provider pricing pages; update alongside MODEL_COST_USD.
 * Passes without recorded tokens (CLI: codex, claude, gemini) use the flat
 * MODEL_COST_USD estimate instead.
 */
const MODEL_TOKEN_RATES = {
  "minimax": { input: 0.30, output: 1.20 },
  "mimo":    { input: 0.10, output: 0.30 },
  "kimi":    { input: 0.60, output: 2.50 },
  "glm":     { input: 0.40, output: 1.60 },
};
```

In `computePipelineMetrics`, add `prompt_tokens, completion_tokens` to the SELECT column list, and replace the cost loop:

```js
  let estimatedCost = 0;
  for (const p of latestPasses) {
    const toolKey = Object.keys(MODEL_COST_USD).find(k => p.tool?.includes(k) || p.model_name?.toLowerCase().includes(k));
    const rates = toolKey && MODEL_TOKEN_RATES[toolKey];
    if (rates && (p.prompt_tokens || p.completion_tokens)) {
      estimatedCost += ((p.prompt_tokens || 0) * rates.input + (p.completion_tokens || 0) * rates.output) / 1_000_000;
    } else if (toolKey) {
      estimatedCost += MODEL_COST_USD[toolKey];
    }
  }
  estimatedCost += (MODEL_COST_USD.claude || 0) * 4;
```

- [ ] **Step 5: Verify**: `npm test`; `node --check` both modified files.

- [ ] **Step 6: Commit**: `git commit -am "feat: token-based cost estimates from captured usage (improvement 18)"`

---

### Task 14: Improvements 15(S) + 19 — Honest prompts; institution-templated prompt strings

**Files:**
- Modify: `backend/src/agents/code-analysis/lenses.js:93,112,199,272`
- Modify: `backend/src/agents/qa-analysis/prompts.js:91,95`
- Modify: `backend/src/agents/accessibility/prompts.js:156`
- Modify: `docs/institutional-adoption/customization.md:177-188`

**Interfaces:**
- All three analysis prompts describe BOTH delivery modes truthfully (pass 1: filesystem; passes 2-5: pre-bundled document).
- `lenses.js` imports `INSTITUTION_NAME` from `../../config.js`; UM-specific strings become config-driven with a neutral fallback.

- [ ] **Step 1: lenses.js.** Add at top: `import { INSTITUTION_NAME } from "../../config.js";` and `const INSTITUTION = INSTITUTION_NAME || "the institution";`

Line 93 — replace:
> `You MUST examine EVERY FILE — no exceptions. Start by listing the full directory tree, then systematically read and analyze every single file.`

with:

> `You MUST examine EVERY FILE PROVIDED — no exceptions. You will receive the codebase in one of two forms: (a) direct filesystem access — list the full directory tree, then systematically read every file; or (b) a pre-bundled document containing every included file inline — read every file section in the bundle. If the bundle lists excluded files, note them as unreviewed in your summary.`

Line 112 — replace `(university-hosted, e.g., campus PostgreSQL, UM CAS, Banner)` with `` (university-hosted, e.g., campus PostgreSQL, ${INSTITUTION} SSO/CAS, campus ERP) `` (the template literal interpolation works because ANALYSIS_PROMPT is already a template literal).

Line 199 — replace `a potential automatic escalation trigger in the UM framework` with `` a potential automatic escalation trigger in ${INSTITUTION}'s AIF framework ``.

Line 272 — replace:
> `You MUST read every single file. Do not skip files. Do not sample. Do not summarize file contents without reading them. After reviewing ALL files, produce your report.`

with:

> `You MUST read every single file provided (filesystem or bundle). Do not skip files. Do not sample. Do not summarize file contents without reading them. After reviewing ALL provided files, produce your report.`

- [ ] **Step 2: qa-analysis/prompts.js.** Line 91 — replace `You have full filesystem access — read any file you need.` with `You will receive the codebase either as direct filesystem access or as a pre-bundled document containing every included file. Review every file provided.` Line 95 — replace `START by listing the full directory tree, then systematically read every source file.` with `START by orienting yourself: with filesystem access, list the directory tree; with a bundle, scan the file headers. Then systematically read every source file provided.`

- [ ] **Step 3: accessibility/prompts.js.** Line 156 — replace `START by listing the full directory tree, then systematically read every file that contains` with `START by orienting yourself (directory tree with filesystem access; file headers in a bundle), then systematically read every provided file that contains`.

- [ ] **Step 4: customization.md.** In the "Known hardcoded values" table (lines 181-186), the rows stand; append one row and update the closing paragraph:

```markdown
| Agent-prompt institution references | `backend/src/agents/code-analysis/lenses.js` | Driven by `INSTITUTION_NAME` with a neutral fallback ("the institution"); no longer hardcoded to UM. |
```

- [ ] **Step 5: Verify**: `node --check src/agents/code-analysis/lenses.js` (import cycle check — config.js has no imports back into agents, so this is safe), `npm test`.

- [ ] **Step 6: Commit**: `git commit -am "fix: prompts describe actual delivery mode; institution strings config-driven (improvements 15/19)"`

---

### Task 15: FW-13 + FW-14 — Review-latency and score-distribution analytics

**Files:**
- Modify: `backend/src/routes/analytics.js` (two new endpoints before `export default`)
- Modify: `frontend/src/api.js` (two fetchers)
- Modify: `frontend/src/components/AdminDashboard.jsx` (panel in the Analytics tab)

**Interfaces:**
- `GET /analytics/review` → `{ latency: [{ track, decided, median_seconds, p90_seconds }], pending: [{ track, count, oldest_age_seconds }] }`
- `GET /analytics/distribution` → `{ tracks: [{ track, count }], histogram: [{ bucket, lo, hi, count }] }` (20 buckets over 0-100%).

- [ ] **Step 1: Endpoints** in `analytics.js` (matching its existing parameterized SQL style):

```js
// Review latency per track: pipeline completion -> review decision (FW-14)
router.get("/review", async (req, res) => {
  const [{ rows: latency }, { rows: pending }] = await Promise.all([
    pool.query(
      `SELECT t.track,
              COUNT(*)::int AS decided,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.review_decided_at - pr.completed_at))) AS median_seconds,
              PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.review_decided_at - pr.completed_at))) AS p90_seconds
       FROM tools t
       JOIN LATERAL (
         SELECT completed_at FROM pipeline_runs
         WHERE tool_id = t.id AND status = 'completed' AND completed_at <= t.review_decided_at
         ORDER BY completed_at DESC LIMIT 1
       ) pr ON true
       WHERE t.review_decided_at IS NOT NULL AND t.track IS NOT NULL
       GROUP BY t.track ORDER BY t.track`
    ),
    pool.query(
      `SELECT track, COUNT(*)::int AS count,
              EXTRACT(EPOCH FROM (NOW() - MIN(updated_at))) AS oldest_age_seconds
       FROM tools WHERE status = 'under_review' AND track IS NOT NULL
       GROUP BY track ORDER BY track`
    ),
  ]);
  res.json({ latency, pending });
});

// Weighted-percentage distribution for threshold calibration (FW-13)
router.get("/distribution", async (req, res) => {
  const [{ rows: tracks }, { rows: histogram }] = await Promise.all([
    pool.query(
      `SELECT track, COUNT(*)::int AS count FROM tools
       WHERE status <> 'draft' AND track IS NOT NULL GROUP BY track ORDER BY track`
    ),
    pool.query(
      `SELECT width_bucket(weighted_percentage, 0, 100, 20) AS bucket,
              (width_bucket(weighted_percentage, 0, 100, 20) - 1) * 5 AS lo,
              width_bucket(weighted_percentage, 0, 100, 20) * 5 AS hi,
              COUNT(*)::int AS count
       FROM tools
       WHERE status <> 'draft' AND weighted_percentage IS NOT NULL
       GROUP BY 1 ORDER BY 1`
    ),
  ]);
  res.json({ tracks, histogram, thresholds: { track2: 22, track3: 42, track4: 65 } });
});
```

- [ ] **Step 2: api.js fetchers** (next to the existing analytics fetchers):

```js
export async function getAnalyticsReview() {
  const res = await request(`/analytics/review`);
  return res.json();
}

export async function getAnalyticsDistribution() {
  const res = await request(`/analytics/distribution`);
  return res.json();
}
```

- [ ] **Step 3: AdminDashboard panel.** Read `AdminDashboard.jsx` first; inside the Analytics tab content, following its existing card/table idiom, add a "Review latency" card fed by `getAnalyticsReview()` and a "Score distribution" card fed by `getAnalyticsDistribution()`. Content requirements (adapt markup to the file's existing card component/classes):
  - Latency table: one row per track, columns Track / Decided / Median / P90 (format seconds as `d h` via a small helper: `s => s == null ? "—" : s > 86400 ? `${(s/86400).toFixed(1)}d` : `${(s/3600).toFixed(1)}h``), plus a "Pending" line per track showing count and oldest age.
  - Distribution: horizontal bar rows per 5% bucket (`<div style={{ width: `${(count / maxCount) * 100}%`, background: C.accent, height: 8, borderRadius: 2 }} />`), with threshold markers noted in the caption: "Track thresholds 22 / 42 / 65 are provisional pending calibration against this distribution."

- [ ] **Step 4: Verify**: `npm test` (backend), `npm run build` (frontend).

- [ ] **Step 5: Commit**: `git commit -am "feat: review-latency and score-distribution analytics (FW-13, FW-14)"`

---

### Task 16: Improvement 17 — Structured q20; payment + autonomous-decision escalators; autonomy rescoring

**Files:**
- Modify: `backend/src/scoring.js` (autonomy rules, escalations)
- Modify: `frontend/src/constants.js` (mirror)
- Modify: `frontend/src/components/IntakeForm.jsx` (q20 becomes radio options)
- Modify: `backend/src/validation.js` (q20 enum in intake validation)
- Modify: `backend/src/scoring.test.js`

**Interfaces:**
- q20 values: `"none" | "recommends" | "acts-with-override" | "autonomous"`. Legacy free-text q20 in existing records: scored as `+1` when length > 10 (old behavior preserved for stored data).
- Autonomy = q20 level (0/1/2/3) + 1 if `q21 === "no"`, capped at 3. (`q21 === "partial"` no longer adds — disclosure is one signal, not the dimension.)
- Two new escalations: `q10` includes `payment` → "Payment card data (PCI DSS)"; `q20 === "autonomous"` → "Autonomous decisions without human review". Escalation count goes 7 → 9 (docs updated in Task 18).

- [ ] **Step 1: Failing tests** (append to `scoring.test.js`):

```js
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
```

- [ ] **Step 2: Run — FAIL.** Implement in `backend/src/scoring.js`. Add near the top:

```js
export const AUTONOMY_LEVELS = { "none": 0, "recommends": 1, "acts-with-override": 2, "autonomous": 3 };
```

Replace the Autonomy block in `computeDimensionScores`:

```js
  // Autonomy: decision scope (q20 enum) + disclosure penalty.
  // Legacy records hold free-text q20; keep the old length heuristic for them.
  let auto;
  if (a.q20 in AUTONOMY_LEVELS) auto = AUTONOMY_LEVELS[a.q20];
  else auto = a.q20 && a.q20.length > 10 ? 1 : 0;
  if (a.q21 === "no") auto += 1;
  s.autonomy = Math.min(auto, 3);
```

Add to `checkEscalations` (before the return):

```js
  if (dt.includes("payment")) e.push("Payment card data (PCI DSS)");
  if (a.q20 === "autonomous") e.push("Autonomous decisions without human review");
```

- [ ] **Step 3: Mirror both changes in `frontend/src/constants.js`** (private `AUTONOMY_LEVELS` const + same two blocks).

- [ ] **Step 4: Form.** In `IntakeForm.jsx`, replace the q20 textarea block with radio options:

```jsx
            <Q n={20} label="What decisions does this tool make or influence?" req routing="Autonomous decision-making without human review triggers escalation." esc={a.q20==="autonomous"?"Autonomous decisions = Track 4":null} answered={isAnswered(a,"q20")} hint={FIELD_HINTS.q20} error={fieldErrors.q20}>
              {[["none","None — informational output only"],["recommends","Recommends — a human makes every decision"],["acts-with-override","Acts automatically — humans can review or override"],["autonomous","Fully autonomous — no human checkpoint"]
              ].map(([v,l]) => <SelectOption key={v} value={v} label={l} selected={a.q20===v} onClick={x=>s("q20",x)} />)}
            </Q>
```

Update `FIELD_HINTS.q20` to `"How independent is this tool's decision-making?"`.

- [ ] **Step 5: Validation.** In `validation.js` `intakeAnswersBase`, change `q20: z.string().optional()` to `q20: z.enum(["none","recommends","acts-with-override","autonomous"]).optional()` (submit-time; legacy free-text lives only in already-stored records, which are not re-validated).

- [ ] **Step 6: Run + fix collateral.** Existing autonomy tests asserting q21-driven scores (`q21:"no"` → +2, `partial` → +1, q20-length → +1) will fail; update them to the new rules, recomputing each expectation by hand. Also recheck `highRiskAnswers()`-based track expectations. `npm test` PASS, `npm run build` PASS.

- [ ] **Step 7: Commit**: `git commit -am "feat: structured q20 decision scope, payment and autonomy escalators (improvement 17)"`

---

### Task 17: Improvement 13 — Re-scoring on resubmission with record versioning (migration 018)

**Files:**
- Create: `backend/migrations/018_tool_versions.sql`
- Modify: `backend/src/routes/intake.js` (resubmit route)
- Modify: `frontend/src/api.js` (resubmitIntake)
- Modify: `frontend/src/components/ToolDetail.jsx` (Edit &amp; resubmit button)
- Modify: `frontend/src/components/IntakeForm.jsx` (resubmit mode)

**Interfaces:**
- `POST /intake/:id/resubmit` (multipart like `/intake`): owner or admin; tool must be `changes_requested`. Validates answers (Task 5), snapshots the current record to `tool_versions`, recomputes scores/escalations/floors/track authoritatively, sets status `under_review` (matches the existing `changes_requested → under_review` transition in the state machine).
- `resubmitIntake(toolId, data, file)` in api.js.
- IntakeForm accepts `resubmitId` (same hash-routing mechanism as `draftId`; check `App.jsx` for how `draftId` is parsed from the route and mirror it).

- [ ] **Step 1: Migration** `backend/migrations/018_tool_versions.sql`:

```sql
-- Snapshot of a tool's scoring state before each resubmission recompute.
-- Makes the versioning promise in escalation-conditions.md true.
CREATE TABLE IF NOT EXISTS tool_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id UUID NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  intake_answers JSONB,
  dimension_scores JSONB,
  weighted_percentage NUMERIC(5,2),
  escalation_conditions JSONB,
  floor_conditions JSONB,
  track INTEGER,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tool_id, version)
);
CREATE INDEX IF NOT EXISTS idx_tool_versions_tool ON tool_versions (tool_id, version);
```

- [ ] **Step 2: Route** in `backend/src/routes/intake.js` (import `withTransaction` from `../db/pool.js` and `validateIntakeAnswers` — already imported after Task 5):

```js
// Resubmit after changes_requested: snapshot old state, recompute, back to review
router.post("/:id/resubmit", upload.single("codebase"), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  const { rows: [existing] } = await pool.query("SELECT * FROM tools WHERE id = $1", [req.params.id]);
  if (!existing) return res.status(404).json({ error: "Tool not found" });
  if (existing.status !== "changes_requested") {
    return res.status(400).json({ error: "Only tools with changes requested can be resubmitted" });
  }
  if (existing.owner_id !== req.user.userId && req.user.role !== "admin") {
    return res.status(403).json({ error: "Only the tool owner can resubmit" });
  }

  const { name, description, artifactType, intakeAnswers } = parseBody(req.body);
  const answers = intakeAnswers || existing.intake_answers;
  const artType = artifactType || existing.artifact_type;
  const validation = validateIntakeAnswers(answers);
  if (!validation.ok) {
    return res.status(400).json({ error: "Intake answers incomplete", details: validation.errors });
  }
  const computed = computeFromAnswers(answers, artType);

  const tool = await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO tool_versions (tool_id, version, intake_answers, dimension_scores,
         weighted_percentage, escalation_conditions, floor_conditions, track, reason)
       SELECT id,
         COALESCE((SELECT MAX(version) FROM tool_versions WHERE tool_id = $1), 0) + 1,
         intake_answers,
         jsonb_build_object(
           'security', score_security, 'accessibility', score_accessibility,
           'dataSensitivity', score_data_sensitivity, 'blastRadius', score_blast_radius,
           'autonomy', score_autonomy, 'comprehension', score_comprehension,
           'maintenance', score_maintenance),
         weighted_percentage, escalation_conditions, floor_conditions, track, 'resubmission'
       FROM tools WHERE id = $1`,
      [req.params.id]
    );
    const { rows: [u] } = await client.query(
      `UPDATE tools SET
         name = COALESCE($1, name), description = COALESCE($2, description),
         artifact_type = $3, intake_answers = $4,
         score_security = $5, score_accessibility = $6, score_data_sensitivity = $7, score_blast_radius = $8,
         score_autonomy = $9, score_comprehension = $10, score_maintenance = $11,
         weighted_percentage = $12, escalation_conditions = $13, floor_conditions = $14, track = $15,
         status = 'under_review', updated_at = NOW()
       WHERE id = $16 RETURNING *`,
      [name || null, description || null, artType, JSON.stringify(answers),
       computed.scores.security, computed.scores.accessibility,
       computed.scores.dataSensitivity, computed.scores.blastRadius,
       computed.scores.autonomy, computed.scores.comprehension, computed.scores.maintenance,
       Math.round(computed.pct * 10000) / 100,
       JSON.stringify(computed.escalations), JSON.stringify(computed.floors),
       computed.track, req.params.id]
    );
    await logAudit({
      actorId: req.user.userId, actorNetid: req.user.netid,
      action: "resubmit_tool", entityType: "tool", entityId: req.params.id,
      details: { fromTrack: existing.track, toTrack: computed.track },
    }, client);
    return u;
  });

  if (req.file) {
    try {
      const codebasePath = await extractUpload(req.file, tool.id);
      await pool.query("UPDATE tools SET codebase_path = $1 WHERE id = $2", [codebasePath, tool.id]);
      tool.codebase_path = codebasePath;
    } catch (err) {
      return res.status(400).json({ error: `Failed to extract codebase: ${err.message}` });
    }
  }

  res.json({ tool, track: computed.track, previousTrack: existing.track });
});
```

- [ ] **Step 3: api.js:**

```js
export async function resubmitIntake(toolId, data, file) {
  return postForm(`/intake/${toolId}/resubmit`, buildIntakeForm(data, file));
}
```

- [ ] **Step 4: Frontend wiring.** Read `App.jsx` to see how the intake route passes `draftId`, then: (a) add a route/param so `#/intake/resubmit/<toolId>` renders `<IntakeForm resubmitId={toolId} />`; (b) in `IntakeForm.jsx`, treat `resubmitId` like `draftId` for loading (reuse the existing `getTool` effect — allow it when `resubmitId` is set even though status is not draft; disable server draft auto-save in this mode by early-returning from `saveToServer` when `resubmitId` is set), and in `handleSubmit` call `resubmitIntake(resubmitId, {...})` instead of `submitIntake`, with toast `` `"${name}" resubmitted — Track ${res.track}` `` and `navigate(`/tool/${resubmitId}`)`; (c) in `ToolDetail.jsx`, when `tool.status === "changes_requested"` and the viewer is the owner, render `<Btn onClick={() => navigate(`/intake/resubmit/${tool.id}`)}>Edit answers &amp; resubmit</Btn>` near the existing status/action controls (read the file and match its layout).

- [ ] **Step 5: Verify**: `npm test`; `npm run build`; trace the state machine: `changes_requested → under_review` is a valid transition in `registry.js` TRANSITIONS (it is — the resubmit path documented in CLAUDE.md).

- [ ] **Step 6: Commit**: `git commit -am "feat: resubmission recomputes scores with tool_versions snapshot (improvement 13)"`

---

### Task 18: Docs reconciliation sweep (FW-15, FW-13 label, FW-09/FW-06/FW-07 doc updates, improvement 20)

**Files:**
- Modify: `README.md:181`
- Modify: `docs/framework/hecvat.md:41-43`
- Modify: `docs/institutional-adoption/compliance-mapping.md:164-172`
- Modify: `docs/framework/escalation-conditions.md:48-57,142-148`
- Modify: `docs/framework/track-routing.md:30-52,167-172,229-231`
- Modify: `docs/framework/scoring-model.md` (autonomy section, comprehension note, example 3, gaming-guard subsection)
- Modify: `docs/institutional-adoption/porting.md:183`
- Modify: `frontend/src/constants.js` + `frontend/src/components/IntakeForm.jsx` (NIST mapping, improvement 20)

Each edit below is an exact replacement; verify surrounding text still reads correctly after each.

- [ ] **Step 1: README.md line 181.** Replace:
> `- **Partial results synthesis** — if 4/5 passes succeed, pipeline continues with available data`

with:
> `- **Partial results synthesis** — synthesis proceeds with whatever passes completed (minimum 1 of 5); such runs are flagged partial_analysis and Track 1 auto-activation is blocked for them`

- [ ] **Step 2: hecvat.md lines 41-43.** Replace the reads-list bullet `- The full codebase (via Claude Code CLI with filesystem access).` with:
> `- The bundled codebase — the same deterministic bundle passes 2-5 receive, subject to the 400K-character budget (the HECVAT pass runs on GLM-5 via direct API, not Claude CLI).`

Search hecvat.md for any other "Claude" claims about this pass and correct them the same way.

- [ ] **Step 3: compliance-mapping.md lines 164-172.** Replace the disposition table and area list to match hecvat.md (the canonical source):

```markdown
| Disposition | Approximate count | Source |
|-------------|-------------------|--------|
| Answerable from code analysis and agent reports | ~57 | Agent 4 HECVAT pass (GLM-5, direct API) reads the codebase bundle plus Agent 1-3 synthesis reports. |
| Requires human input (contractual, organizational) | ~30 | Marked `REQUIRES_HUMAN_INPUT` so reviewers know what remains. |
```

and replace the "Question categories covered:" sentence with the 26 area codes actually used in hecvat.md's table: DOCU, ITAC, THRD, CONS, APPL, AAAI, CHNG, DATA, DCTR, FIDP, PPPR, VULN, HIPA, PCID, PCOM, PTHP, PDAT, PRPO, DPAI, AIGN, AIPL, AISC, AIML, AILM (write them with the full names as hecvat.md lists them).

- [ ] **Step 4: escalation-conditions.md.**
  - Line 144: replace the sentence with: `On intake submission (POST /intake), the escalation array is persisted on the tools.escalation_conditions field as a JSON array of human-readable strings, and floor conditions on tools.floor_conditions. When intake answers change on resubmission (status changes_requested), the prior scoring state is snapshotted to the tool_versions table and scores, escalations, and track are recomputed authoritatively.`
  - Condition 2 (lines 48-57): rewrite for the split rule — trigger is now `q10 contains ferpa AND (q5 = public-noauth OR (q5 = public-auth AND q6 != sso))`; add a paragraph: `FERPA on an internet-reachable deployment protected by campus SSO no longer forces Track 4; it applies a Track 3 floor instead (tools.floor_conditions), guaranteeing IT review without consuming formal-project capacity. Rationale: essentially every modern campus web app is internet-reachable behind SSO; forcing all of them into Track 4 collapsed the proportionality the framework is named for.`
  - Update the "seven conditions" count language: `grep -n "seven" docs/framework/*.md docs/institutional-adoption/*.md README.md` and change escalation-count references to nine, listing the two new conditions (Payment card data; Autonomous decisions without human review). Add short sections for both new conditions following the file's existing per-condition format (Trigger / Rationale).

- [ ] **Step 5: track-routing.md.**
  - After the threshold tables (line ~52), insert: `These thresholds are provisional. They were set by expert judgment, not calibrated against a submission corpus; no calibration dataset yet exists. The admin analytics distribution view (GET /analytics/distribution) exists to collect exactly that evidence — revisit the boundaries after the first production cycle.`
  - Line 172: replace `- Department head sign-off is documented.` with `- The builder submits a written attestation (minimum 20 characters) plus explicit confirmations that findings were reviewed and escalation conditions understood; all of it is stored on the review note and audit log.`
  - Line 231: append to the paragraph: ` The distribution endpoint (GET /analytics/distribution) provides the historical distribution this requires.`

- [ ] **Step 6: scoring-model.md.**
  - Comprehension section (lines 110-121): append after the rationale: `q19 is asked of every submission, AI-built or not — comprehension risk is universal. (Earlier versions only showed q19 for AI-classified tools, which silently assigned maximum comprehension risk to every non-AI tool.)`
  - Autonomy section: rewrite its rule table for the q20 enum: levels none=0 / recommends=1 / acts-with-override=2 / autonomous=3, plus +1 when q21=no, capped at 3; note the legacy free-text handling (length > 10 → 1) for records predating the enum.
  - Weight Profiles section: after the Profile Rationale list, add a subsection:

```markdown
### Applicable-Profile Guard

The weight profile is not purely self-declared. Profiles implied by the answers are always evaluated alongside the declared type, and routing uses the highest resulting percentage: an authenticated web surface (q5 = public-auth or campus-vpn) adds the internal-app profile; an unauthenticated public surface (q5 = public-noauth) adds public-site; AI classification (q1 = ai-agent or external AI per q12) adds ai-agent. Consequence: switching q1 alone can never lower a tool's track, which closes the gaming vector where declaring "ai-agent" (a profile that weights autonomy and comprehension heavily) diluted the percentage for tools scoring 0 on those dimensions.
```

  - Worked Example 3 (lines 220-246): fix line 240's arithmetic to `2×3 + 3×1 + 2×3 + 2×4 + 1×4 + 0×4 + 0×3 = 6 + 3 + 6 + 8 + 4 + 0 + 0 = 27`, then recompute the example under the new rules and rewrite the ending: q20 must now be an enum (use `recommends`, autonomy = 1, unchanged score vector); the guard also evaluates the internal-app profile (public-auth surface): internal-app weights [3,3,4,2,1,2,3], weighted sum = 2×3+3×3+2×4+2×2+1×1+0+0 = 28/54 = 51.9% → the effective percentage is max(40.9%, 51.9%) = 51.9% → Track 3 by percentage. The FERPA escalation no longer fires (public-auth + SSO); the Track 3 floor applies. Final: **Track 3**. Rewrite the closing paragraph to walk through exactly that.
  - Worked Example 2: no change needed beyond confirming q19 in its answer list now matches a question the form actually asks (it does after Task 4).

- [ ] **Step 7: porting.md line 183.** Replace `- The four-track routing percentages (22 %, 42 %, 65 %)` with `- The four-track routing percentages (22 %, 42 %, 65 %) — provisional values; calibrate against your own submission distribution via the admin analytics distribution view`.

- [ ] **Step 8: NIST mapping surfaced (improvement 20).** In `frontend/src/constants.js` add:

```js
// NIST AI RMF subcategories per scoring dimension (docs/institutional-adoption/compliance-mapping.md)
export const DIMENSION_NIST = {
  security: "MEASURE 2.7",
  accessibility: "MEASURE 2.9",
  dataSensitivity: "MEASURE 2.10 · MAP 5.1",
  blastRadius: "MAP 5.1",
  autonomy: "GOVERN 1.2 · MANAGE 1.2",
  comprehension: "MEASURE 2.9 · GOVERN 1.2",
  maintenance: "GOVERN 6.1",
};
```

In `IntakeForm.jsx` sidebar dimension rows (line ~602), import `DIMENSION_NIST` and add a tooltip: `<span className="mono" title={`${DIMENSION_LABELS[k]} — NIST AI RMF: ${DIMENSION_NIST[k]}`} style={{ width: 36, fontSize: 9, ... }}>{l}</span>` (add the `title` attr to the existing label span; keep everything else). Below the dimension list add one caption line: `<div style={{ fontSize: 9, color: C.textDim, marginTop: 6 }}>Dimensions map to NIST AI RMF subcategories — hover a label.</div>`

- [ ] **Step 9: Verify**: re-read each edited doc section in full for coherence (counts, cross-references); `npm run build`; `npm test`.

- [ ] **Step 10: Commit**: `git commit -am "docs: reconcile docs with implementation; provisional thresholds; NIST surfacing (FW-15, FW-13)"`

---

### Task 19: Sync CLAUDE.md and project memory; full verification

**Files:**
- Modify: `/projects/AIF/CLAUDE.md`
- Modify: `/root/.claude/projects/-projects-AIF/memory/` (memory file + MEMORY.md pointer)

- [ ] **Step 1: CLAUDE.md updates** (it is gitignored but on disk — edit in place):
  - Escalation conditions: "7 conditions" → "9 conditions"; add payment-data and autonomous-decision entries; note the FERPA split (public-noauth or non-SSO public-auth escalates; public-auth+SSO floors at Track 3 via `checkFloors`/`tools.floor_conditions`).
  - Scoring: q19 asked of all tools; q20 is a decision-scope enum feeding autonomy; applicable-profile guard (`applicableProfiles`, `computeEffectivePercentage`).
  - Pipeline rules: Track 1 auto-activation gated by `pipeline/activation-gate.js` (contradictions, confirmed criticals, partial analysis, truncated bundle); synthesis has a deterministic-merge fallback; HECVAT receives the code bundle; pass_results records prompt/completion tokens; cost is token-based where usage exists.
  - Review workflow: self-certify requires attestation payload; track override enforces documented constraints; resubmission recomputes scores and snapshots to `tool_versions`.
  - Analytics: add `/analytics/review` and `/analytics/distribution`.
  - Migrations: note 015-018.
  - Key Files: add `src/pipeline/activation-gate.js`.
- [ ] **Step 2: Memory.** Write `/root/.claude/projects/-projects-AIF/memory/phase1-remediation.md` (type: project) summarizing: memo location, all 15 findings addressed, which improvements were implemented vs deferred (lens redesign, bundle sharding, annual re-attestation — deferred pending pilot data), migrations 015-018 added. Add a one-line pointer to `MEMORY.md`.
- [ ] **Step 3: Full verification**: `cd /projects/AIF/backend && npm test` (all green), `cd /projects/AIF/frontend && npm run build`, `node --check` on every modified backend file (`git diff --name-only HEAD~18 -- 'backend/src/**/*.js' | xargs -n1 node --check`).
- [ ] **Step 4: Commit**: `git commit -am "docs: sync CLAUDE.md with phase-1 remediation"`

---

## Deferred (explicitly out of scope, per the memo's own recommendation)

- **Improvement 15 (L core):** replacing 4 identical API passes with 3 differentiated lenses — requires pilot-data comparison before switching. The S-effort prompt-honesty fixes ARE done (Task 14).
- **Improvement 11 (L part):** sharding excluded files across passes 2-5 — the coverage flag (Task 11) ships first and provides the data to justify it.
- **Improvement 13 (L part):** annual re-attestation for active Track 1-2 tools — policy decision plus scheduler; resubmission re-scoring (Task 17) covers the drift-on-change case.

## Self-Review Notes

- Spec coverage: FW-01→T1, FW-02→T12, FW-03→T5, FW-04→T4, FW-05→T3, FW-06→T2, FW-07→T8, FW-08→T7, FW-09→T9+T18, FW-10→T10, FW-11→T11, FW-12→T6, FW-13→T15+T18, FW-14→T15, FW-15→T18. Improvements 1-14, 16-20 map to T1-T18; 15's S-part to T14.
- Type consistency: `computeTrack` returns `{ track, scores, escalations, floors, weightedPct, profileUsed }` (backend) from T3 onward; `checkFloors` returns `[{ track, reason }]`; gate returns `{ activate, blocked, reasons, contradictions }`; these names are used consistently in T2/T3/T12/T17.
- Ordering: T2 before T6 (warnings reference floors); T1 before T12 (gate hooks into the freshTool block); T4/T5/T16 before T18 (docs describe final scoring rules); T10 before T11 (metadata stamping assumes the fallback restructure).
