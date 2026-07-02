# Testing

AIF uses Node.js's built-in test runner (`node:test`) with `node:assert`. There is no Jest, no Mocha, no Vitest — the goal is zero test-framework dependencies and fast cold starts. The suite covers scoring correctness, route validation schemas, and state-machine integrity. This document explains how to run the tests, what they cover, and how to add new ones.

## Running Tests

```bash
cd backend
npm test
```

This resolves to:

```bash
node --test src/*.test.js src/**/*.test.js
```

Tests auto-discover any file ending in `.test.js`. No config file, no glob patterns to maintain. The runner exits non-zero on any failure, so it integrates directly with CI.

Current suite: **324 tests across 6 files**.

### Run a Single File

```bash
node --test src/scoring.test.js
```

### Run a Single Suite or Test

```bash
node --test --test-name-pattern="reviewDecisionSchema" src/routes/review.test.js
```

`--test-name-pattern` matches against both `describe` blocks and `it` names.

### Watch Mode

```bash
node --test --watch src/*.test.js src/**/*.test.js
```

## Test Pattern

Every test file follows the same skeleton:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { functionUnderTest } from "./module.js";

describe("function name — behaviour group", () => {
  it("does the specific thing", () => {
    const result = functionUnderTest(input);
    assert.equal(result.field, expected);
  });
});
```

Rules:

- Import from `node:test` and `node:assert` only — never bring in a framework
- Use `assert/strict` for deep equality without coercion
- Prefer `describe` blocks for logical grouping; nested `describe` is fine
- Tests must be deterministic — no timers, no external services, no filesystem mutation outside `os.tmpdir()`

## What's Covered

### `src/scoring.test.js` — scoring engine

The authoritative scoring module (`src/scoring.js`) is covered exhaustively because it directly drives track routing and therefore governance outcomes.

- Dimension score computation from raw answers (all 21 questions)
- Weighted percentage math per artifact type
- Track routing at the boundary values (22%, 42%, 65%)
- All nine escalation conditions trigger correctly
- Frontend (`frontend/src/constants.js`) and backend (`src/scoring.js`) weight matrices match dimension-for-dimension
- Edge cases: missing answers, unknown artifact types, multi-select arrays

Scoring is the most business-critical module in the codebase. See [architecture/scoring.md](../architecture/scoring.md) for the domain rules these tests enforce.

### `src/routes/registry.test.js` — status state machine

The `TRANSITIONS` map in `routes/registry.js` is the portal's source of truth for status changes. This suite re-declares the map identically and tests:

- Every valid transition (`draft → pending`, `pending → in_progress`, etc.)
- Every invalid transition (builder cannot approve, reviewer cannot delete, etc.)
- Role restrictions (only `reviewer` and `admin` can move `under_review → approved`)
- The `system` role can auto-advance Track 1 tools
- Exhaustive coverage — every status key has a tested entry
- Structural integrity — no status references a target that is not itself a key

### `src/routes/review.test.js` — review workflow

- `reviewDecisionSchema` accepts `approved` / `changes_requested`, rejects everything else
- `trackOverrideSchema` requires an integer 1-4 and a non-empty reason
- `reviewNoteSchema` requires a non-empty body
- Review-specific transitions (Track 2 self-certify path, Track 3-4 approval path)
- Self-certify constraints (builder cannot self-certify Track 3+ tools)

### `src/routes/pipeline.test.js` — pipeline validation

- `pipelineRunSchema` — uploaded file vs. git URL, mutually exclusive
- URL validation — HTTPS required, shell metacharacters rejected (`;`, `&`, `|`, backticks, `$()`)
- `MODEL_COST_USD` sanity — every configured model has a positive per-pass cost
- Retry constants — max 2 attempts, dead letter threshold enforced

### `src/routes/intake.test.js` — intake lifecycle

- Intake payload validation (all 21 questions, artifact type, display name)
- Draft creation, update, and submit lifecycle
- Score computation parity between draft preview and submitted authoritative score
- Edge cases: missing q20 (free text), empty multi-select, unknown artifact

## What's Not Covered

The test suite deliberately excludes:

- **LLM output parsing** — stubbing the five models produces brittle tests; live provider connectivity is instead exercised by running the real pipeline (`node src/index.js <path>`)
- **Database integration tests** — route handlers are tested via their schemas and state machines; full DB integration happens in deployed environments
- **Frontend components** — React components have no automated tests. The frontend relies on `npm run build` catching type/import errors, WCAG is validated by the in-pipeline accessibility agent against the portal itself

If you need a full integration test, use the CLI entry point (`node src/index.js <path>`) against a checked-in fixture codebase. There is no separate provider smoke-test script — a live pipeline run against a small fixture codebase is the way to verify `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, and `ANTHROPIC_API_KEY` all resolve correctly after rotating keys or changing model IDs, since it exercises the actual `agents/shared/direct-api.js` and `agents/shared/cli.js` code paths rather than a disconnected roster.

## Adding a New Test File

Create a file alongside the module under test, ending in `.test.js`:

```bash
touch src/routes/notifications.test.js
```

Skeleton:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { notificationPrefsSchema } from "../validation.js";

describe("notificationPrefsSchema", () => {
  it("accepts partial updates", () => {
    const result = notificationPrefsSchema.safeParse({ notify_email: true });
    assert.ok(result.success);
  });

  it("rejects empty object", () => {
    const result = notificationPrefsSchema.safeParse({});
    assert.ok(!result.success);
  });
});
```

Run it:

```bash
node --test src/routes/notifications.test.js
```

It will be picked up automatically by `npm test` on the next run.

## Adding Tests to an Existing File

Keep suites focused. If you are testing a new state machine behaviour, add to `registry.test.js`. If you are adding a Zod schema, add to the matching route test file.

When a test file grows past ~400 lines, split by behaviour — e.g. `registry.test.js` and `registry.transitions.test.js` rather than one monolith.

## Test Hygiene

- **No shared state between tests.** Each `it` should construct its own inputs. Module-level constants are fine; mutable fixtures are not.
- **No network calls.** If you find yourself wanting to test an HTTP route end-to-end, extract the logic into a pure function and test that.
- **No timing dependencies.** Do not use `setTimeout` or real clocks. Use `node:test`'s `mock.timers` if you genuinely need time control.
- **Fast.** The full suite runs in under five seconds. A slow test either has a bug or does not belong.

## Frontend Build Check

The frontend has no unit tests but `npm run build` is a de facto type-check — it surfaces import errors, unused imports in strict mode, and Vite plugin failures.

```bash
cd frontend && npm run build
```

CI should run this on every PR. See [contributing.md](contributing.md) for the full PR checklist.

## CI Integration

A typical CI job runs:

```bash
cd backend
npm ci
npm test
cd ../frontend
npm ci
npm run build
```

No databases, no services, no secrets needed — all tests are offline.

## Related Reference

- [architecture/scoring.md](../architecture/scoring.md) — the domain rules the scoring tests enforce
- [architecture/pipeline.md](../architecture/pipeline.md) — pipeline design, not covered by tests
- [contributing.md](contributing.md) — PR checklist requires `npm test` to pass
