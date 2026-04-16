# Deterministic Tools (Layer 0)

## Summary

Layer 0 is a set of rule-based code scanners that run in parallel with the
multi-model pipeline. They produce ground-truth findings — reproducible, with
zero false negatives for the rules they encode — and their results are merged
into the corresponding agent's synthesis as `toolVerified: true`,
`confidence: "confirmed"`. Unlike model passes, they are non-blocking: a
scanner failure is logged, emits a `tool_complete` SSE event with
`skipped: true`, and the pipeline continues. All scanners execute under a
hardened subprocess environment (`toolEnv()`) that strips API keys so an
untrusted codebase cannot exfiltrate secrets via a malicious config.

## Roster

| Tool | Targets | Module | Merges into |
|------|---------|--------|-------------|
| Semgrep | Python, JS/TS, Go, Java, Ruby, others (OWASP Top Ten + default rules) | `backend/src/agents/code-analysis/semgrep.js` | Agent 1 |
| npm audit | Node dependencies via `package-lock.json` | `backend/src/agents/code-analysis/dep-audit.js` | Agent 1 |
| pip-audit | Python dependencies via `requirements.txt` / `pyproject.toml` | `backend/src/agents/code-analysis/dep-audit.js` | Agent 1 |
| Snyk Agent Scan | (Legacy integration — group with dep-audit) | `backend/src/agents/code-analysis/dep-audit.js` | Agent 1 |
| ESLint jsx-a11y | React/JSX accessibility | `backend/src/agents/accessibility/linter.js` | Agent 2 |
| ESLint QA | JS/TS dead code, unreachable code, duplicate keys, unsafe patterns | `backend/src/agents/qa-analysis/eslint-qa.js` | Agent 3 |

## Execution Model

All deterministic tools follow the same contract:

```
async function runX(codebasePath, outputDir)
  -> object | null     // null = skipped (tool not installed, no code to scan, failure)
```

The orchestrator wraps them in `runToolWithEvents()` in
`backend/src/orchestrator/direct-api.js:338-354`:

```js
async function runToolWithEvents(name, target, fn) {
  emit({ type: "tool_start", tool: name, target });
  const start = Date.now();
  try {
    const result = await fn();
    emit({ type: "tool_complete", tool: name, target,
           elapsed: (Date.now() - start) / 1000,
           findings: result?.findings?.length || 0,
           skipped: !result });
    return result;
  } catch (err) {
    emit({ type: "tool_complete", ..., skipped: true, error: err.message });
    return null;
  }
}
```

All six scans run under `Promise.all` alongside Agents 1 and 2; ESLint QA runs
alongside Agent 3. See
[pipeline-internals.md](./pipeline-internals.md#layer-0-deterministic-tools).

## Semgrep

`backend/src/agents/code-analysis/semgrep.js` runs Semgrep with two packs:

- `p/default` — high-signal Semgrep rules across all supported languages.
- `p/owasp-top-ten` — OWASP Top Ten 2021 patterns.

Command:

```
semgrep \
  --config p/default \
  --config p/owasp-top-ten \
  --json \
  --output <outputDir>/semgrep_results.json \
  --quiet --no-git-ignore --timeout 60 \
  <codebasePath>
```

Timeout: 300 s total (5 min), 60 s per rule. On success the runner parses
`semgrep_results.json`, maps severity (ERROR→high, WARNING→warning, INFO→info)
with an override from `extra.metadata.impact` when present (HIGH→high,
MEDIUM→warning, LOW→info), and produces structured findings with `cwe`,
`owaspIds`, `confidence`, and `references` preserved. The raw output is
written to `<outputDir>/semgrep_findings.json`.

## Dependency Audit

`backend/src/agents/code-analysis/dep-audit.js` detects ecosystems by scanning
for manifest files in the codebase root and common subdirectories
(`frontend/`, `backend/`, `api/`, `server/`, `client/`, `app/`, `web/`). The
module supports npm, yarn, pip, mix, ruby, and go.

### npm audit

Preferred input is `package-lock.json`; if absent, the runner attempts
`npm install --package-lock-only --no-audit --ignore-scripts` (60 s timeout)
to synthesize a lockfile. If even that fails, npm audit is skipped with a
warning. Runs `npm audit --json --omit=dev` (60 s). Output is parsed as
npm-audit v2 schema: vulnerabilities keyed by package, each with `severity`
and a `via` array that distinguishes direct advisories (object entries) from
transitive imports (string entries).

### pip-audit

Run when `requirements.txt` or `pyproject.toml` is detected. Uses the
`pip-audit` CLI with JSON output, mapped to the same finding shape.

### Severity Mapping (npm and pip)

```
critical → critical    high → high    moderate → warning    low → info
```

## ESLint jsx-a11y

`backend/src/agents/accessibility/linter.js` detects React / Next / Vue / etc.
by inspecting `package.json` dependencies in the codebase's likely source
roots. For a React codebase it writes a flat ESLint config to a temp
directory with the following rule profile (abbreviated):

```
jsx-a11y/alt-text                           error
jsx-a11y/anchor-has-content                 error
jsx-a11y/aria-props                         error
jsx-a11y/aria-proptypes                     error
jsx-a11y/aria-role                          error
jsx-a11y/click-events-have-key-events       error
jsx-a11y/heading-has-content                error
jsx-a11y/label-has-associated-control       error
jsx-a11y/no-noninteractive-element-
   interactions                             error
jsx-a11y/no-static-element-interactions     error
jsx-a11y/role-has-required-aria-props       error
jsx-a11y/role-supports-aria-props           error
jsx-a11y/tabindex-no-positive               error
... plus several `warn` level rules
```

The linter runs `eslint --config <tmpConfig> --format json <codebase>` and
post-processes violations into the common finding shape with `ruleId` set to
the jsx-a11y rule name. Framework detection is conservative — if no React
is detected, the runner returns `null` (skipped) instead of scanning.

## ESLint QA

`backend/src/agents/qa-analysis/eslint-qa.js` targets JS/TS projects only
(detected by scanning for `.js`/`.jsx`/`.ts`/`.tsx` files). Rule profile
focuses on correctness and dead code — things models catch inconsistently:

```
Dead code:
  no-unused-vars          error (ignorePattern "^_")
  no-unreachable          error
  no-unreachable-loop     error
  no-constant-condition   error
  no-constant-binary-expression  error

Correctness:
  no-dupe-keys            error
  no-dupe-args            error
  no-duplicate-case       error
  no-func-assign          error
  no-import-assign        error
  no-self-assign          error
  no-self-compare         error
  use-isnan               error
  valid-typeof            error
  no-unsafe-negation      error
  no-unsafe-optional-chaining  error

Bug-prone patterns:
  (see eslint-qa.js for full list)
```

If `tsconfig.json` is present, the runner bootstraps
`@typescript-eslint/parser` and enables type-aware rules. Output is mapped to
categories (`dead_code`, `correctness`, `bug_prone`, `typescript`) to enable
structured grouping in the Agent 3 synthesis.

## Snyk Agent Scan

Snyk is positioned alongside `dep-audit` for CVE-grade dependency analysis.
The integration requires `SNYK_TOKEN` in the environment; when absent the
scan is skipped. Snyk's output is normalized to the same finding shape as
npm-audit / pip-audit before merging into Agent 1. No license-scan policy
enforcement is implemented today — only vulnerability findings are imported.

## Subprocess Environment

All deterministic tools use `toolEnv()` from
`backend/src/agents/shared/cli.js:21-23`:

```js
export function toolEnv(extras = {}) {
  return {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    NODE_ENV: process.env.NODE_ENV,
    ...extras,
  };
}
```

No API keys are passed to Semgrep or ESLint subprocesses. Tools that need a
specific credential (Snyk) receive exactly that one variable via the
`extras` argument. This prevents a malicious `.eslintrc`, Semgrep custom
rule, or lifecycle script from reading `OPENAI_API_KEY` /
`OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` from `process.env`.

## Finding Merge Rules

The orchestrator merges scanner findings into the corresponding Agent's
synthesis after the multi-model synthesis completes. Each scanner finding is
shaped to match the agent's finding schema with these additional fields:

```js
{
  severity, category, title, detail, evidence,
  reportedBy: ["semgrep"] | ["eslint-plugin-jsx-a11y"] | ["npm"] | ["pip"],
  convergenceCount: 1,
  confidence: "confirmed",
  toolVerified: true,
  /* plus tool-specific: ruleId, cwe, owasp, fixAvailable */
}
```

### Deduplication

For Semgrep and ESLint, the merge step deduplicates against existing model
findings by `evidence` (file:line) exact-match and by title-prefix overlap
(`direct-api.js:406-437`, `458-478`). This prevents double-counting when
multiple models independently identify the same SQL injection that Semgrep
also catches.

### Summary Block

Each scanner's summary block is attached to the synthesis JSON for reviewer
transparency:

```json
{
  "semgrep":    { "tool": "semgrep", "totalScanned": N, "deduplicated": M, "findingsAdded": K, "bySeverity": {...} },
  "depAudit":   { "tools": [...], "ecosystems": [...], "totalVulnerabilities": N, "bySeverity": {...} },
  "a11yLinter": { "tool": "eslint-plugin-jsx-a11y", "filesScanned": N, "errors": E, "warnings": W },
  "eslintQA":   { "tool": "eslint-qa", "typescript": true|false, "filesScanned": N, "byCategory": {...} }
}
```

## Installation Requirements

The backend Docker image is expected to have the following binaries on
`$PATH`:

- `semgrep` — Python package, installed by the Docker build.
- `npm` — provided by the Node base image.
- `pip-audit` — Python package, installed by the Docker build.
- `snyk` — optional; skipped if absent.
- `eslint` — installed via the temp package layer each run.
- `pandoc` — for Agent 4 markdown-to-docx conversion.

A missing binary is logged at `info` and the scanner returns `null`. The
pipeline continues — deterministic tools are strictly additive.

## Cross-references

- How synthesis consumes tool findings: [pipeline-internals.md](./pipeline-internals.md)
- Subprocess isolation (`toolEnv` / `filteredEnv`): [security.md](./security.md)
- SSE event shape for `tool_start` / `tool_complete`: [pipeline-internals.md](./pipeline-internals.md)
