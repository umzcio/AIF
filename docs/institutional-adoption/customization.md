# Customizing AIF

## Summary

AIF separates configuration into three tiers by the change-control cost required to modify a given value. The first tier is environment-variable configuration: institution identity, authentication strategy, administrator accounts, email delivery, data-retention thresholds, and pipeline credentials. These values change with a container restart and carry no code-review obligation. The second tier is governance-model customization: the twenty-one intake questions, the weight profiles across the six artifact types, the track-routing percentages, and the seven escalation conditions. These values are encoded in source files that the test suite enforces for consistency; changing them is a code change and should go through the institution's normal review process. The third tier is pipeline customization: adding or modifying agents, prompts, and deterministic scanners. This document enumerates every customization surface, classifies it by tier, and records known hardcoded values that have not yet been externalized.

## Tier 1 — Environment variables

The canonical reference for every environment variable AIF reads is [getting-started/configuration.md](../getting-started/configuration.md). The subset below calls out values most commonly customized during institutional adoption.

### Institution identity

| Variable | Effect | File |
|----------|--------|------|
| `INSTITUTION_NAME` | Displayed in the top bar, email footer, generated compliance documents | `backend/src/config.js` |
| `INSTITUTION_DOMAIN` | Used to construct default sender addresses and metadata | `backend/src/config.js` |
| `FRONTEND_URL` | Absolute URL used in email links and SSO callback construction | `backend/src/config.js` |
| `BASE_PATH` | URL prefix the portal mounts under; default `/aif` | `backend/src/config.js` |

The frontend reads the first two at runtime from `/api/config` and therefore does not require a rebuild when either changes.

### Authentication

| Variable | Values | Purpose |
|----------|--------|---------|
| `AUTH_PROVIDER` | `cas`, `header`, `oidc`, `saml`, `bypass` | Selects the SSO provider module loaded at startup |
| `ADMIN_NETIDS` | Comma-separated usernames | Accounts auto-promoted to `admin` role on first login |
| `JWT_SECRET` | 64 hex chars | Cookie signing key; rotating invalidates all sessions |

Each provider has its own set of required variables. CAS requires `CAS_BASE_URL` and `CAS_SERVICE_URL`; header auth requires `AUTH_HEADER_USER`; OIDC and SAML document their required variables inline in the stub provider files.

### Email

| Variable | Purpose |
|----------|---------|
| `SMTP_HOST` | SMTP relay; leaving blank disables email delivery entirely |
| `SMTP_PORT` | Relay port, default `25` |
| `SMTP_FROM` | From address on outgoing notifications |

In-app notifications continue to function even when SMTP is disabled.

### Pipeline credentials and behavior

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | Codex CLI, pass 1 |
| `OPENROUTER_API_KEY` | MiniMax, MiMo, Kimi, GLM, passes 2–5 |
| `ANTHROPIC_API_KEY` | Claude Code CLI, synthesis |
| `SNYK_TOKEN` | Optional MCP/skill security scan |
| `OUTPUT_DIR` | Pipeline output storage, default `/data/output` |
| `CODEBASES_DIR` | Uploaded codebase storage, default `/data/codebases` |

### Data retention

Retention thresholds are enforced by the scheduled job in `backend/src/jobs/retention.js` and are tunable via environment variables documented in [admin-guide/overview.md](../admin-guide/overview.md). Defaults: pass results 90 days, read notifications 30 days, audit log report-only.

## Tier 2 — Governance model

The values in this tier encode institutional policy decisions. Changing them is safe but requires touching source files under `backend/src/` and, for values mirrored between backend and frontend, keeping the two in sync. The test suite (`npm test`, 271 tests) enforces parity; `scoring.test.js` fails if the frontend and backend weight profiles diverge.

### Authentication providers

To add a new provider — for example a campus-specific CAS variant or an internal OAuth server — create `backend/src/auth/providers/<name>.js` implementing the three-function interface:

```
export default {
  name: "<name>",
  getLoginUrl() { /* redirect URL or null for no-redirect flows */ },
  async authenticate(req) { /* return { netid, displayName } or null */ },
  getLogoutUrl() { /* logout URL or null */ },
};
```

Add a `case` to the switch in `backend/src/auth/providers/index.js` and set `AUTH_PROVIDER=<name>` at runtime. No other file changes are required.

### Intake questions

The twenty-one intake questions are declared in `frontend/src/components/IntakeForm.jsx` and their scoring interpretation lives in `backend/src/scoring.js`. Customization guidance:

- Question wording, help text, and response-option labels may be edited directly in `IntakeForm.jsx`.
- Adding or removing a question requires a coordinated change across `IntakeForm.jsx`, `scoring.js`, and `frontend/src/constants.js`.
- Response-option identifiers (for example `public-noauth`, `custom-auth`, `no-vc`) are load-bearing: `scoring.js` reads them literally. Renaming one requires updating every reference.

The backend recomputes dimension scores and tracks authoritatively on submit; the frontend computation in `constants.js` is preview-only. Any edit that affects scoring must update both files.

### Weight profiles

Weight profiles are defined identically in two places and must remain in sync:

| File | Export |
|------|--------|
| `backend/src/scoring.js` | `WEIGHT_PROFILES` |
| `frontend/src/constants.js` | `WEIGHT_MATRIX` |

The default profiles are:

| Artifact type | SEC | A11Y | DATA | BLAST | AUTO | COMP | MAINT |
|--------------|-----|------|------|-------|------|------|-------|
| `public-site` | 4 | 4 | 3 | 3 | 1 | 2 | 3 |
| `internal-app` | 3 | 3 | 4 | 2 | 1 | 2 | 3 |
| `script-api` | 3 | 0 | 3 | 2 | 2 | 2 | 3 |
| `ai-agent` | 3 | 1 | 3 | 4 | 4 | 4 | 3 |
| `data-pipeline` | 3 | 0 | 4 | 2 | 2 | 2 | 3 |
| `other` | 3 | 2 | 3 | 2 | 1 | 2 | 3 |

Institutions that want to weight a given dimension differently — for example raising Accessibility for internal apps subject to Section 508 — should edit both files and run `npm test` to confirm parity.

### Track-routing percentages

The three decision boundaries are constants in the `routeToTrack` function in `backend/src/scoring.js`:

```
if (weightedPct >= 0.65) return 4;
if (weightedPct >= 0.42) return 3;
if (weightedPct >= 0.22) return 2;
return 1;
```

The frontend preview in `constants.js` uses the same constants. Changing these thresholds shifts the proportion of submissions routed to each track. The scoring test suite verifies boundary behavior and will fail if an edit accidentally creates a gap or overlap.

### Escalation conditions

The seven conditions that force Track 4 regardless of weighted percentage are implemented in the `checkEscalations` function in `backend/src/scoring.js` (and mirrored in `frontend/src/constants.js`). Each condition is a small predicate over the raw intake answers. Institutions may add, remove, or alter conditions to reflect local policy — for example, adding an escalation when the responsible builder is a student contractor rather than a permanent employee.

### Status state machine

Valid status transitions are declared in the `TRANSITIONS` object in `backend/src/routes/registry.js`, keyed by actor role. The tests in `registry.test.js` exhaustively validate the map, so adding a new transition requires updating the tests as well. Consult the existing entries before adding new states; new statuses also require changes to `STATUS_META` in `frontend/src/constants.js` for display.

## Tier 3 — Agent pipeline

### Agent prompts

Each agent's prompt and output schema live in a single file under `backend/src/agents/`:

| Agent | Prompt file | Schema file |
|-------|-------------|-------------|
| 1 — Code & Security | `code-analysis/lenses.js` | `code-analysis/schema.js` |
| 2 — Accessibility | `accessibility/prompts.js` | `accessibility/schema.js` |
| 3 — QA / Bug Detection | `qa-analysis/prompts.js` | `qa-analysis/schema.js` |
| 4 — Documentation | `documentation/prompts.js` | — |
| 4 — HECVAT (second Claude pass) | `documentation/hecvat-prompt.js` | — |

Prompts may be modified to reflect institution-specific concerns — for example, a medical school might extend the Code & Security prompt to check for PHI handling patterns specific to its electronic health record integrations. The JSON output schema files enforce structured output and must be kept in sync with any prompt edits that alter the expected response shape.

### Adding a new agent

A new agent is a directory under `backend/src/agents/<name>/` containing:

- `prompts.js` — the shared prompt consumed by all five passes
- `schema.js` — the JSON Schema enforced on model output
- `runner.js` — orchestrates the five passes plus synthesis

Register the agent in `backend/src/orchestrator/index.js`, update the pipeline queue in `backend/src/pipeline/queue.js`, and add a display entry to the `AGENTS` constant in `frontend/src/constants.js`. Full instructions are in `docs/development/extending-agents.md` (planned).

### Model roster

The five-model pass roster is defined in the orchestrator (`backend/src/orchestrator/direct-api.js`) and per-model timeouts and costs are in `backend/src/pipeline/queue.js` (`MODEL_COST_USD`). Swapping a model — for example replacing Kimi K2 with a locally hosted alternative — requires only changing the model identifier and, for anything beyond OpenRouter, potentially adding a new adapter in `backend/src/agents/shared/direct-api.js`.

### Deterministic scanners

Semgrep, ESLint (jsx-a11y and QA), `npm audit`, `pip-audit`, and the optional Snyk agent-scan are invoked from the respective agent runners. Replacing a scanner, adding a new rule set, or introducing a new tool means editing the runner and, if findings are stored, updating the schema. The ESLint configuration files are at the repository root and may be edited directly to add or suppress rules.

## Branding and visual design

### CSS design system

Colors are declared as CSS custom properties in `frontend/src/styles.css` and are themed for light and dark mode via `[data-theme="dark"]` selectors. Track and severity colors are hex constants in `frontend/src/constants.js` (`TRACK_COLORS`, `SEVERITY_CONFIG`, `STATUS_META`). These values were chosen to satisfy WCAG 2.2 AA contrast requirements at 4.5 : 1 on the portal's standard backgrounds; any change should be re-validated against the same ratio.

### Fonts

DM Sans and JetBrains Mono are loaded from Google Fonts in `frontend/index.html`. Institutions with a licensed typeface may substitute self-hosted fonts by replacing the `<link>` tags and the CSS `font-family` declarations.

### Logo and favicon

The hero image on the GitHub README (`AIF.png`) is not used inside the portal. The portal's top bar displays the short product name as text. Institutions wishing to add a logo should place the asset in `frontend/public/` and reference it from `frontend/src/components/TopBar.jsx`.

## Known hardcoded values

These values are currently hardcoded in source and have not been externalized. They are candidates for future configuration work; institutions that need to change them today must edit the file directly.

| Value | Location | Notes |
|-------|----------|-------|
| Email header and button color `#1A6B4B` | `backend/src/notifications.js` (HTML template in `sendEmail`) | Currently tracks the portal's default accent. Institutions with brand guidelines should substitute their primary color. |
| Email subject prefix `[AIF]` | `backend/src/notifications.js` (`sendMail` subject field) | Change to match local mail taxonomy if required. |
| Framework version string `"2026.1"` | `frontend/src/constants.js` (`APP_META.frameworkVersion`) | Advance when the institution's governance body ratifies a new framework version. |
| Product names (`"AI Tool Intake"`, `"AIF"`, `"Higher Education Edition"`) | `frontend/src/constants.js` (`APP_META`) | User-facing strings; edit to match local naming conventions. |
| Agent-prompt institution references | `backend/src/agents/code-analysis/lenses.js` | Driven by `INSTITUTION_NAME` with a neutral fallback ("the institution"); no longer hardcoded to UM. |

Email branding colors are the most commonly requested customization during adoption and are tracked as a future configuration-surface improvement. The agent-prompt row above shows the target pattern for the remaining entries in this table: externalize via an environment-backed config export (`backend/src/config.js`) with a neutral fallback, rather than a source edit.

## Keeping customizations maintainable

When forking or patching AIF for local customization, the following practices minimize drift from upstream:

- Commit environment-variable changes to an institution-specific `.env` file held outside the source tree; never fork simply to change configuration.
- Preserve the original scoring-module exports; add institution-specific predicates as additions rather than edits so merging upstream changes remains straightforward.
- Run `npm test` after every customization that touches scoring, registry, or pipeline code. The 271-test suite is fast and catches most regressions.
- Record institutional deviations from the default framework in your local governance documentation so reviewers understand why the portal behaves differently from the upstream reference.

## Where to go next

- [porting.md](porting.md) — step-by-step adoption procedure for a new institution
- [compliance-mapping.md](compliance-mapping.md) — how AIF's controls align with external standards
- [getting-started/configuration.md](../getting-started/configuration.md) — complete environment-variable reference
- [admin-guide/overview.md](../admin-guide/overview.md) — operational responsibilities and tuning
- [framework/](../framework/) — the governance policy the portal enforces
