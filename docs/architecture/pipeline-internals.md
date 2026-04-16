# Pipeline Internals

## Summary

The pipeline is a two-layer review engine. Layer 0 is deterministic scanners
(Semgrep, npm audit, pip-audit, ESLint jsx-a11y, ESLint QA, Snyk) that run in
parallel with Layer 1, which is a four-agent LLM pipeline. Three of the four
agents use a uniform multi-model convergence pattern: five independent models
receive the same prompt and the same codebase bundle, then a sixth model
(Claude Opus 4.6 via Claude Code CLI) synthesizes their outputs with full
filesystem access to resolve disputes. The fourth agent generates
documentation plus a HECVAT 4 Lite self-assessment in three parallel calls.
All pipeline orchestration lives in one file —
`backend/src/orchestrator/direct-api.js` — driven by an in-process queue
(`backend/src/pipeline/queue.js`) and streamed to clients via SSE.

## Pipeline Modes

As of migration 014, there is one active mode: `direct-api`. Legacy modes
(`standard`, `opencode`) remain as historical values in the
`pipeline_runs.pipeline_mode` column but are not supported by the current
orchestrator. A pipeline run is started via:

```
POST /aif/api/pipeline/:toolId/run   { track?: 1–4, mode: "direct-api" }
```

The schema is enforced by `pipelineRunSchema` in
`backend/src/validation.js:62-65` which rejects any mode other than
`direct-api`.

## Queue and Lifecycle

`backend/src/pipeline/queue.js` implements a single-slot in-process queue.
There is no Redis, Postgres LISTEN/NOTIFY, or external broker.

```
enqueue(toolId, track, parentRunId?, mode)
  ├─ verify retry budget (MAX_RETRIES = 2, migration 005)
  ├─ INSERT pipeline_runs (status='queued', pipeline_mode)
  ├─ INSERT 4 agent_results rows (passes_total = 5 for 1–3, 1 for 4)
  └─ processNext()

processNext()
  ├─ guard: if already processing, return
  ├─ SELECT next 'queued' run ORDER BY queued_at ASC LIMIT 1
  ├─ create AbortController, store in runControllers.get(runId)
  ├─ set status='running', emit SSE 'status: running'
  ├─ resolve codebase: local path OR git clone (validated URL) into /data/codebases/<toolId>
  ├─ defense-in-depth: resolve().startsWith(CODEBASES_DIR)  (queue.js:214-218)
  ├─ load previous findings (differential review)
  ├─ await runDirectApiPipeline({ codebasePath, signal, onProgress, ... })
  ├─ on success: Track 1 → status='active'; Track 2–4 → status='under_review'
  ├─ compute pipeline_metrics (latest attempt per pass_key)
  ├─ notify owner + reviewers (Track 2–4)
  └─ finally: processNext() again to drain queue
```

### Cancellation

```
POST /aif/api/pipeline/:runId/cancel
  └─ cancelRun(runId)
      ├─ runControllers.get(runId).abort()   — signals downstream awaits
      ├─ killRunProcesses(runId)             — SIGTERM then SIGKILL after 5s
      └─ withTransaction:
           UPDATE pipeline_runs SET status='cancelled', cancel_requested=true
           UPDATE agent_results ... running -> failed
           UPDATE tools SET status='pending' WHERE status='in_progress'
```

The AbortSignal is passed into every `runCLIWithRetry()` (Codex, Claude) and
every `runDirectPass()` (OpenRouter), so all outstanding network and
subprocess work aborts promptly.

### Retry and Dead Letter

```
POST /aif/api/pipeline/:runId/retry
  └─ retryRun(runId)
      ├─ fetch failedRun; require status IN ('failed','cancelled')
      ├─ reject if retry_count >= MAX_RETRIES (2)
      └─ enqueue() with parent_run_id = runId (retry_count = parent + 1)
```

On the third attempt the orchestrator refuses and surfaces the failure. The
chain is preserved via `pipeline_runs.parent_run_id` so reviewers can walk
back through every attempt.

## Layer 0 Deterministic Tools

Deterministic scanners are invoked from `direct-api.js` via a small helper,
`runToolWithEvents`, which emits `tool_start`/`tool_complete` SSE events and
swallows tool failures so they are non-fatal to the pipeline. They run in
parallel with Agent 1 and Agent 2:

```js
await Promise.all([
  runAgentDirect(AGENTS[0], ...),            // Agent 1 (code + security)
  runAgentDirect(AGENTS[1], ...),            // Agent 2 (accessibility)
  runToolWithEvents("jsx-a11y",  ...),       // eslint-plugin-jsx-a11y
  runToolWithEvents("npm-audit", ...),       // dep-audit.js (npm+pip+go+ruby)
  runToolWithEvents("semgrep",   ...),       // SAST rules p/default + p/owasp-top-ten
]);
```

Findings from the scanners are merged into the corresponding agent's
synthesis with `toolVerified: true`, `convergenceCount: 1`, and
`confidence: "confirmed"`. See [deterministic-tools.md](./deterministic-tools.md).

## Layer 1 Agents

```
Agent 1: Code & Security    5 model passes + Claude synthesis + (Agent 1 only) stack deep dive
Agent 2: Accessibility      5 model passes + Claude synthesis
Agent 3: QA / Bug Detection 5 model passes + Claude synthesis
Agent 4: Documentation      3 parallel single passes (Gemini guides, GLM-5 HECVAT, Claude compliance)
```

Agents 1 and 2 run in parallel. Agent 3 runs after Agents 1 and 2 complete
because it consumes their syntheses as context. Agent 4 runs last and
consumes all three prior syntheses via `collectAgentReports()` in
`backend/src/agents/documentation/runner.js`.

### Model Roster

All five models receive the same prompt per agent. Only execution paths
differ.

| Pass | Model | Identifier | Execution |
|------|-------|-----------|-----------|
| 1 | GPT-5.4 | `gpt-5.4-2026-03-05` | Codex CLI, full FS access |
| 2 | MiniMax M2.5 | `minimax/minimax-m2.5` | OpenRouter direct |
| 3 | MiMo-V2-Flash | `xiaomi/mimo-v2-flash` | OpenRouter direct |
| 4 | Kimi K2 | `moonshotai/kimi-k2` | OpenRouter direct |
| 5 | GLM-5 | `z-ai/glm-5` | OpenRouter direct |
| Synthesis | Claude Opus 4.6 | `claude-opus-4-6` | Claude Code CLI, full FS access |

Identifiers come from `backend/src/agents/shared/direct-api.js:37-42` and
`backend/src/agents/shared/cli.js:147,174`. Override env vars:
`CODEX_MODEL`, `CLAUDE_MODEL`, `GEMINI_MODEL`.

## Codebase Bundling

Passes 2–5 do not have filesystem access, so the orchestrator pre-bundles the
codebase once with `bundleCodebase()`
(`backend/src/agents/shared/codebase-bundle.js`) and shares the result across
all agents.

```
bundleCodebase(codebasePath, { maxChars = 400_000 })
  ├─ walk, skipping .git, node_modules, __pycache__, dist, build, .next, coverage, .cache
  ├─ exclude binaries, minified files, media, lockfiles
  ├─ include source + config (tsconfig, Dockerfile, docker-compose, .eslintrc, etc.)
  ├─ skip .json > 10 KB unless it is a known config file
  ├─ sort alphabetically for determinism
  ├─ if total chars ≤ 400 KB: include everything
  └─ else prioritize: p1 manifests → p2 config/readme → p3 source (largest first)
```

The bundle manifest is written to `_bundle_manifest.json` in the run
directory so reviewers can audit what each model was shown.

## Direct-API Pass Runner

`runDirectPass()` in `backend/src/agents/shared/direct-api.js` is the single
entry point for OpenRouter models. It enforces structured JSON output using a
three-tier fallback:

```
1. response_format: { type: "json_schema", json_schema: { strict: true, schema } }
2. response_format: { type: "json_object" }
3. (no response_format)
```

Each model gets 10 min wall-clock, `temperature = 0`, `max_tokens = 16384`.
HTTP 422 or error text mentioning `response_format` / `json_schema` is
treated as "this model does not support that format" and the runner advances
to the next tier. Transient 429 / 5xx also advance. JSON parsing accepts
bare JSON, markdown-fenced JSON, and progressive brace-matching
(`direct-api.js:221-247`). A parsed object must contain at least one known
analysis key (`findings`, `wcagChecklist`, `inventory`, ...) to be accepted
as an analysis result — this rejects CLI envelopes and error objects.

## CLI Pass Runner

`runCLI()` in `backend/src/agents/shared/cli.js` handles Codex, Gemini, and
Claude Code. Each tool gets a pinned model via `-m` and a filtered
environment (`filteredEnv(tool)`) that passes only the specific API key that
tool needs — defense against prompt-injected exfiltration.

| Tool | Sandbox flag | Timeout |
|------|-------------|---------|
| Codex | `--dangerously-bypass-approvals-and-sandbox` with OPENAI_API_KEY only | 15 min |
| Gemini | `-y` | 10 min |
| Claude | `--allowedTools Read,Glob,Grep,Bash(cat:*,ls:*,head:*,...)` | 25 min |

For prompts over 120 KB, Claude is given a meta-prompt that points to a
temp file — this avoids the `MAX_ARG_STRLEN` (128 KB) spawn-argument ceiling
(`cli.js:190-206`).

## Convergence and Confidence Tiers

After five passes, each agent-level synthesis uses the following tiers
(documented in `frontend/src/constants.js` and implemented in the synthesis
prompts at `backend/src/agents/*/prompts.js`):

| Tier | Definition |
|------|-----------|
| `tool-verified` | Reported by a deterministic scanner (Semgrep, ESLint, npm audit, pip-audit, Snyk). `toolVerified: true`, `convergenceCount: 1` |
| `confirmed` | Reported by 3+ models independently |
| `potential` | Reported by 1–2 models |
| `clean` | Not flagged by any source for that category |

The synthesis prompt directs Claude to reconcile disagreements, not merely
take a vote. When 3 models say a bug exists and 2 say it does not, Claude
reads the cited file with its filesystem access and decides. This is why
synthesis runs through Claude Code CLI rather than a raw API call — it
needs `Read`, `Grep`, and `Glob` to resolve disputes with ground truth.

## Agent 4: Documentation

`runDocGenerationParallel()` in
`backend/src/agents/documentation/runner.js:202-335` runs three passes in
parallel:

| Pass | Model | Output |
|------|-------|--------|
| Guides | Gemini 3.1 Pro Preview (CLI) | USER_GUIDE.md + ADMIN_GUIDE.md |
| HECVAT | GLM-5 (direct OpenRouter) | hecvat_assessment.json + .xlsx (87 questions) |
| Compliance | Claude Opus 4.6 (CLI) | COMPLIANCE_SUMMARY.md |

Markdown outputs are converted to `.docx` via `pandoc`. HECVAT output is
validated and scored in `runner.js:344-365`: `totalQuestions`,
`answeredFromCode`, `requiresHumanInput`, and a readiness percentage
computed from `yes` / `not_applicable` over total answerable questions.

## SSE Event Schema

Every significant state change emits an SSE event. Consumers subscribe via
`GET /aif/api/pipeline/:runId/stream`.

| type | Fields | Meaning |
|------|--------|---------|
| `status` | `{ status, error? }` | Run-level: queued / running / completed / failed / cancelled |
| `pipeline_start` | `{ toolName, track, outputDir, mode }` | First event after run begins |
| `agent_start` | `{ agent, label, index, passesTotal }` | An agent's execution begins |
| `agent_complete` | `{ agent, index, passes, failures, summary, partial }` | Synthesis finished |
| `pass_start` | `{ agent, pass, model }` | One model pass begins (or synthesis) |
| `pass_log` | `{ agent, pass, model, lines }` | Throttled (500 ms) stderr/stdout |
| `pass_complete` | `{ agent, pass, model, elapsed, jsonParsed, outputBytes }` | Single pass finished |
| `pass_failed` | `{ agent, pass, model, error, errorCategory }` | Pass failed after retries |
| `pass_retry` | `{ agent, pass, model, attempt, error }` | Retrying with a new attempt |
| `tool_start` / `tool_complete` | `{ tool, target, elapsed?, findings?, skipped? }` | Deterministic scanners |
| `tools_summary` | `{ tools: { name: { status, findings } } }` | Late-subscribe catch-up |
| `pipeline_complete` | `{ result }` | Final payload before closing |

`backend/src/pipeline/events.js` caches recent tool states per run
(`toolStatesByRun`) so an SSE client that reconnects mid-run receives a
faithful snapshot via `tools_summary`.

## Partial Results

If ≥1 of the 5 model passes succeeds, the agent proceeds to synthesis with a
`partialCaveat` that tells Claude exactly which models failed
(`direct-api.js:183-186`). The synthesis JSON's `metadata.partial_analysis`
is set so downstream UI can warn reviewers that the analysis is incomplete.
If all 5 passes fail, the agent throws and the run fails.

## Differential Review

When a tool has a prior successful run, `queue.js:224-243` reads the previous
`synthesis.json` for Agents 1–3 and appends a `PRIOR RUN FINDINGS` section to
the current synthesis prompt. Claude is asked to label each prior finding
as `resolved`, `open`, or `partial`, and flag new findings with
`priorStatus: "new"`.

## Cost and Metrics

`computePipelineMetrics()` (`queue.js:410-466`) runs on completion:

- `total_elapsed_seconds = completed_at - started_at`
- `queue_wait_seconds = started_at - queued_at`
- `estimated_cost_usd` — sum of `MODEL_COST_USD[tool]` per latest-attempt
  pass, plus four synthesis Claude calls (agents 1–3 synthesis + HECVAT)
- `passes_total / succeeded / failed`, `json_parse_failures`

Cost values in `MODEL_COST_USD` (`queue.js:43-51`) are hardcoded
approximations; they are updated manually when pricing shifts.

## Cross-references

- Deterministic scanners and flat configs: [deterministic-tools.md](./deterministic-tools.md)
- SSE client (usePipelineStream): [frontend.md](./frontend.md)
- Subprocess environment filtering and sandbox flags: [security.md](./security.md)
- `pass_results` schema and retry model: [database.md](./database.md)
