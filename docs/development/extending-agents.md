# Extending the Agent Pipeline

The AIF pipeline is built around a small contract that every agent must satisfy. If you want to add a new analysis agent — a license audit, a performance profiler, a threat-model generator — you implement three files, register the agent with the orchestrator, and wire its findings into the frontend. This guide walks through the full process. Read [architecture/pipeline.md](../architecture/pipeline.md) first for the design rationale.

## Agent Types

There are two patterns:

| Pattern | Example | Structure |
|---------|---------|-----------|
| **Multi-model** | Code Analysis, Accessibility, QA | 5 independent model passes + Claude synthesis |
| **Generation** | Documentation | Parallel Claude-driven passes that produce artefacts |

Most new agents will be multi-model. They reuse the shared orchestration path in `orchestrator/direct-api.js` — you supply prompts and a schema, the orchestrator handles passes, retries, timeouts, and synthesis.

## File Layout

A new agent lives under `backend/src/agents/<name>/`:

```
backend/src/agents/<name>/
├── prompts.js      # ANALYSIS_PROMPT, SYNTHESIS_PROMPT, PASSES
├── schema.js       # JSON Schema for structured output enforcement
└── runner.js       # (optional) wrapper if the agent has custom pre/post logic
```

Shared infrastructure lives under `agents/shared/` and is reused — do not duplicate:

- `shared/cli.js` — Codex/Claude CLI execution, JSON extraction, env filtering
- `shared/direct-api.js` — OpenRouter passes with structured JSON enforcement
- `shared/codebase-bundle.js` — deterministic file selection, 400 KB budget

## Step 1: Write the Analysis Prompt

Create `backend/src/agents/<name>/prompts.js`:

```js
const OUTPUT_SCHEMA = `
You MUST output your findings as a single JSON object with this exact schema.
Do not wrap in markdown code fences. Output ONLY the JSON.

{
  "summary": "string — 2-3 sentence summary",
  "findings": [
    {
      "severity": "critical|high|warning|info",
      "category": "string",
      "title": "string",
      "detail": "string",
      "evidence": "file:line"
    }
  ],
  "scoringSignals": {
    "<dimension>": { "score": 0, "reasoning": "string" }
  }
}
`;

export const ANALYSIS_PROMPT = `You are a <purpose> analysis agent for the AI Production Readiness Framework (AIF).

Your job is to perform a COMPREHENSIVE analysis of a codebase against a specific evaluation rubric. You MUST examine EVERY FILE — no exceptions.

=====================================================================
SECTION 1: <FIRST TOPIC>
=====================================================================

<Instructions for the model>

=====================================================================
SECTION 2: <SECOND TOPIC>
=====================================================================

<...>

=====================================================================
SEVERITY DEFINITIONS
=====================================================================

CRITICAL — <definition>
HIGH — <definition>
WARNING — <definition>
INFO — <definition>

${OUTPUT_SCHEMA}`;

// All 5 passes use the SAME prompt — each model independently analyses the codebase.
export const PASSES = {
  pass1: { name: "Pass 1 (Codex/GPT-5.4)", tool: "codex" },
  pass2: { name: "Pass 2 (MiniMax M2.5)", tool: "direct-api" },
  pass3: { name: "Pass 3 (MiMo-V2-Flash)", tool: "direct-api" },
  pass4: { name: "Pass 4 (Kimi K2)", tool: "direct-api" },
  pass5: { name: "Pass 5 (GLM-5)", tool: "direct-api" },
};

export const SYNTHESIS_PROMPT = `You are the synthesis agent for the <purpose> audit in AIF. You received independent reports from multiple AI models.

Your job is to merge these reports into a single authoritative report AND resolve disputes.

CONVERGENCE RULES:
- Finding reported by 3+ models → CONFIRMED
- Finding reported by 1-2 models → POTENTIAL
- When models give different answers to the same question → DISPUTE (investigate)

You have READ ACCESS to the codebase. When models disagree, go read the code to determine truth.

Output JSON with this schema:
{
  "summary": "",
  "findings": [
    { "severity": "", "category": "", "title": "", "detail": "", "evidence": "",
      "reportedBy": [], "convergenceCount": 0, "confidence": "confirmed|potential" }
  ],
  "disputes": [
    { "topic": "", "type": "factual|judgment", "investigation": "", "verdict": "", "resolution": "resolved|needs_human_review" }
  ],
  "scoringSignals": {
    "<dimension>": { "median": 0, "range": [0, 0], "byModel": {} }
  },
  "convergenceStats": { "confirmed": 0, "potential": 0, "resolved": 0, "needs_human_review": 0 }
}

Output only the JSON. No markdown fences, no commentary.`;

export { OUTPUT_SCHEMA };
```

Follow the template from `agents/code-analysis/lenses.js`. That file is the canonical example and is 600 lines of well-tested prompt engineering — do not improvise.

### Prompt Rules

- **ONE prompt for ALL five models.** Convergence only works if every model sees the same instructions.
- **Demand structured JSON output.** The direct-API path enforces the schema; Codex does not, so repeat the schema in the prompt body.
- **Every section must produce content.** Tell the model "if no findings, say so explicitly" — empty sections rejected as incomplete.
- **Severity definitions are canonical.** Copy from `code-analysis/lenses.js` Section 10 verbatim.
- **Require file:line evidence on every finding.** The synthesis step drops findings that cite files that do not exist.

## Step 2: Write the JSON Schema

Create `backend/src/agents/<name>/schema.js`:

```js
/**
 * <Name> Agent JSON Schema
 *
 * Machine-readable JSON Schema for the OpenRouter response_format parameter.
 * Matches OUTPUT_SCHEMA in prompts.js.
 */

export const YOUR_AGENT_SCHEMA = {
  type: "object",
  required: ["summary", "findings", "scoringSignals"],
  additionalProperties: true,
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["severity", "title", "evidence"],
        additionalProperties: true,
        properties: {
          severity: { type: "string", enum: ["critical", "high", "warning", "info"] },
          category: { type: "string" },
          title: { type: "string" },
          detail: { type: "string" },
          evidence: { type: "string" },
        },
      },
    },
    scoringSignals: {
      type: "object",
      additionalProperties: true,
    },
  },
};
```

The schema is enforced via OpenRouter's `response_format` parameter. The direct-API runner has a three-tier fallback — strict schema, `json_object` mode, free-form — so malformed responses degrade instead of failing outright.

Set `additionalProperties: true` everywhere. Models sometimes add extra fields and we should not reject them.

## Step 3: Register with the Orchestrator

Open `backend/src/orchestrator/direct-api.js` and add your agent to the `AGENTS` array:

```js
import {
  PASSES as YOUR_PASSES,
  ANALYSIS_PROMPT as YOUR_PROMPT,
  SYNTHESIS_PROMPT as YOUR_SYNTHESIS,
} from "../agents/your-agent/prompts.js";
import { YOUR_AGENT_SCHEMA } from "../agents/your-agent/schema.js";

const AGENTS = [
  { name: "code-analysis", ... },
  { name: "accessibility", ... },
  { name: "qa-analysis", ... },
  { name: "your-agent",
    label: "Your Agent Label",
    index: 3,
    passes: YOUR_PASSES,
    prompt: YOUR_PROMPT,
    synthPrompt: YOUR_SYNTHESIS,
    schema: YOUR_AGENT_SCHEMA },
];
```

Then add a block in `runDirectApiPipeline` to invoke the agent. Place it sequentially — agents 1 and 2 run in parallel because they are independent; agent 3 reads 1 and 2's output. Decide which your agent needs:

```js
checkCancel();
emit({ type: "agent_start", agent: "your-agent", label: "Your Label", index: 3, passesTotal: passes.length });
const yourDir = join(runDir, "agent4_your_agent");
const yourResult = await runAgentDirect(AGENTS[3], codebasePath, codeBundle, passes, yourDir, emit, agentOpts);
const yourSummary = summarizeFindings(yourResult.synthesis);
emit({ type: "agent_complete", agent: "your-agent", index: 3,
  passes: Object.keys(yourResult.passes).length, failures: yourResult.failures.length,
  summary: yourSummary, partial: yourResult.partial });
```

Add it to the final result payload:

```js
const result = {
  // ...
  agents: {
    codeAnalysis: { ... },
    accessibility: { ... },
    qaAnalysis: { ... },
    documentation: { ... },
    yourAgent: {
      passes: Object.keys(yourResult.passes).length,
      failures: yourResult.failures,
      synthesis: yourResult.synthesis,
      partial: yourResult.partial,
    },
  },
};
```

## Step 4: Handle New Finding Categories (Optional)

If your agent reports findings that need downstream normalisation (e.g. mapping to a scoring dimension, threading into HECVAT answers, feeding a new filter in the UI), add logic in the agent's post-synthesis block. The existing Agent 1 block merging Semgrep, npm audit, and Snyk findings is the pattern:

```js
if (externalToolResult?.findings?.length && yourResult.synthesis) {
  const toolFindings = externalToolResult.findings.map(f => ({
    severity: f.severity,
    category: f.category,
    title: f.title,
    detail: f.detail,
    evidence: f.evidence,
    reportedBy: [f.tool],
    convergenceCount: 1,
    confidence: "confirmed",
    toolVerified: true,
  }));
  yourResult.synthesis.findings = [...(yourResult.synthesis.findings || []), ...toolFindings];
  writeFileSync(join(yourDir, "synthesis.json"), JSON.stringify(yourResult.synthesis, null, 2));
}
```

Keep deterministic-tool findings tagged with `toolVerified: true` — the frontend uses this to promote them to the "Tool-Verified" confidence tier.

## Step 5: Wire into the Documentation Agent

Agent 4 (documentation) reads outputs from agents 1, 2, and 3 as context when generating the Compliance Summary. If your new agent produces findings that should show up in that summary, update `backend/src/agents/documentation/runner.js` to pass your synthesis as additional context to the Claude documentation prompt.

If your agent is strictly analytical and does not affect external documentation, you can skip this step.

## Step 6: Update the Frontend Report

Open `frontend/src/components/Report.jsx` and add a tab for your agent's findings:

```jsx
<Tab label="Your Agent" value="your-agent" />
```

Then render the synthesis:

```jsx
{activeTab === "your-agent" && (
  <AgentFindings
    agent="your-agent"
    synthesis={run.agents.yourAgent.synthesis}
    partial={run.agents.yourAgent.partial}
  />
)}
```

Register the agent in `frontend/src/constants.js`:

```js
export const AGENTS = [
  { key: "codeAnalysis", label: "Code & Security", ... },
  { key: "accessibility", label: "Accessibility", ... },
  { key: "qaAnalysis", label: "QA / Bugs", ... },
  { key: "yourAgent", label: "Your Label", icon: YourIcon, color: "#..." },
  { key: "documentation", label: "Documentation", ... },
];
```

Use the `C` constants for colours — never hardcode hex values. See [architecture/frontend.md](../architecture/frontend.md) for frontend conventions.

## Step 7: Update the Pipeline UI

`frontend/src/components/Pipeline.jsx` tracks per-agent progress from the SSE stream. The agent is auto-tracked if it emits the standard `agent_start`, `pass_start`, `pass_complete`, and `agent_complete` events — which the orchestrator does for you. No change required unless your agent has unique pass types (e.g. Agent 1's `stack-check` pass).

## Step 8: Add Tests

Add a schema test to `backend/src/routes/` if your agent introduces new validation (rare — most agents consume, not receive, user input).

The real test of a new agent is running it against a known codebase and reading the output. There is no assertion-based test of prompt quality — prompt engineering is validated by result inspection and by comparing multi-model convergence rates over time.

## Step 9: Run Locally

```bash
cd backend
node src/index.js /path/to/test/codebase TRACK_3
```

Watch the log stream. Verify:

- Your agent runs after (or in parallel with) the others as expected
- All five passes emit `pass_start` and `pass_complete` events
- Each pass produces `pass<N>.json` or `pass<N>_raw.txt` in your agent's output dir
- `synthesis.json` is produced and contains valid JSON matching your schema
- Findings carry `reportedBy`, `convergenceCount`, and `confidence` fields

## Per-Model Timeouts

Every pass has a 10-minute timeout in `runDirectApiPipeline`. If your agent analyses large codebases and consistently times out, raise the `timeout` parameter passed to `runDirectPass`:

```js
const directResult = await runDirectPass(directModel, agentDef.prompt, codeBundle, outputDir, {
  runId, signal, schema: agentDef.schema, onOutput,
  timeout: 15 * 60 * 1000,
});
```

Codex (pass 1) has its own 15-minute timeout set in `shared/cli.js`.

## Cost Budgeting

Each new agent adds five model passes plus a Claude synthesis call. Rough cost per run at current OpenRouter pricing: ~$0.15 per pass, ~$0.30 for synthesis, so a new agent adds **about $1 per pipeline run**. Update `MODEL_COST_USD` in `pipeline/queue.js` if you change model selection, so the analytics dashboard stays accurate.

## Finding Normalisation

The portal expects findings to follow a uniform shape:

```js
{
  severity: "critical" | "high" | "warning" | "info",
  category: string,
  title: string,
  detail: string,
  evidence: "file:line",
  reportedBy: string[],      // which models/tools flagged it
  convergenceCount: number,  // how many models agreed
  confidence: "confirmed" | "potential",
  toolVerified?: boolean,    // true if from a deterministic scanner
}
```

Do not invent new severity levels, new confidence tiers, or new required fields. The Report component, findings review workflow, and HECVAT pre-fill all depend on this shape.

## Common Pitfalls

| Symptom | Cause | Fix |
|---------|-------|-----|
| Synthesis drops all findings | File paths don't exist in the codebase | Models hallucinated paths; tighten prompt to require real files |
| All 5 passes return empty findings | Prompt is too vague | Copy rubric structure from `code-analysis/lenses.js` |
| JSON parse failures on 3+ passes | Schema too strict, response truncated | Set `additionalProperties: true`, loosen required fields |
| Synthesis timeouts | Pass outputs combined too large | Lower `MAX_PASS_CHARS` in orchestrator (default 15000) |
| Missing pass in UI | Agent not in frontend `AGENTS` constant | Register the agent key in `frontend/src/constants.js` |
| Track routing unchanged when agent reports issues | Agents do not drive track routing | Track routing is determined by the 21 intake answers; agents produce findings, not scores |

## Related Reference

- [architecture/pipeline.md](../architecture/pipeline.md) — pipeline design, convergence rules, synthesis flow
- [architecture/agents.md](../architecture/agents.md) — per-agent responsibilities and rubrics
- [setup.md](setup.md) — local development setup
- [testing.md](testing.md) — test strategy
