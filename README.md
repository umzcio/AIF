# AI Production Readiness Framework (AIF)

A risk-tiered governance framework and review portal for moving AI-assisted tools from prototype to production at the University of Montana.

Builders submit tools → the system scores them on four dimensions → routes them to a tier → runs a multi-model agent pipeline → produces structured reports with findings, escalation signals, and scoring recommendations.

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        INTAKE                                   │
│  Builder submits tool → 4-dimension scoring → tier assignment   │
│                                                                 │
│  Data Sensitivity (0-3)  ─┐                                     │
│  Blast Radius (0-3)      ─┤─→  Composite 0-12 ─→ Tier          │
│  Autonomy (0-3)          ─┤    + escalation condition override  │
│  Builder Comprehension    ─┘                                    │
│  (0-3)                                                          │
│                                                                 │
│  0-2 → EXPLORE    3-5 → PILOT    6-8 → DEPLOY    9-12 → ESCALATE│
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     AGENT PIPELINE                              │
│                                                                 │
│  Tier determines depth:                                         │
│    EXPLORE   → 2 models  (Codex, Gemini)                       │
│    PILOT     → 3 models  (+ Grok)                              │
│    DEPLOY    → 5 models  (+ Kimi, Qwen)                        │
│    ESCALATE  → 5 models  + human review                        │
│                                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │  Agent 1  │ │ Agent 2  │ │ Agent 3  │ │  Agent 4  │            │
│  │  Code &   │ │ Access-  │ │  HECVAT  │ │   Docs    │            │
│  │ Security  │ │ ibility  │ │  4 Lite  │ │Generation │            │
│  │multi-model│ │multi-mod.│ │  Claude  │ │  Claude   │            │
│  │    ✓      │ │    ✓     │ │    ✓     │ │    ✓      │            │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                        REPORT                                   │
│  Synthesized findings, escalation signals, scoring,             │
│  dispute resolutions, recommended tier                          │
└─────────────────────────────────────────────────────────────────┘
```

## Agent 1: Code Analysis (implemented)

Agent 1 is the core of the pipeline. It sends the same comprehensive analysis prompt to multiple AI models, each running independently via its own CLI tool with full filesystem access. No model sees another's work. Claude then synthesizes the reports, resolves disputes by reading the actual code, and produces a single authoritative report.

### Architecture

```
                    ┌─────────────────────────┐
                    │    ANALYSIS PROMPT       │
                    │  (identical for all 5)   │
                    │                          │
                    │  10-section rubric:       │
                    │  1. Inventory            │
                    │  2. External Services    │
                    │  3. Data Operations      │
                    │  4. Authentication       │
                    │  5. Secrets              │
                    │  6. AI Model Usage       │
                    │  7. MCP/Agent Security   │
                    │  8. Escalation Checks    │
                    │  9. Scoring Signals      │
                    │  10. Findings            │
                    └────────┬────────────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │  ... up to 5
            ▼                ▼                ▼
   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
   │  Codex CLI   │  │ Gemini CLI  │  │  opencode   │
   │  (GPT-4o)    │  │ (Gemini 2.5)│  │ (Grok/Kimi/ │
   │              │  │             │  │    Qwen)    │
   │ reads files  │  │ reads files │  │ reads files │
   │ greps code   │  │ greps code  │  │ greps code  │
   │ follows      │  │ follows     │  │ follows     │
   │  imports     │  │  imports    │  │  imports    │
   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
          │                │                │
          ▼                ▼                ▼
   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
   │  pass1.json  │  │  pass2.json  │  │  pass3.json  │
   │  (structured │  │  (structured │  │  (structured │
   │   report)    │  │   report)    │  │   report)    │
   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
          │                │                │
          └────────────────┼────────────────┘
                           │
              ┌────────────┤  (optional)
              │            │
              ▼            ▼
   ┌──────────────┐  ┌──────────────┐
   │  Snyk Agent  │  │    Claude    │
   │    Scan      │  │   Code CLI   │
   │  (automated) │  │  (synthesis) │
   │              │  │              │
   │ MCP configs  │  │ 1. Merge     │
   │ skill files  │  │ 2. Resolve   │
   │ prompt inj.  │  │    disputes  │
   │ tool poison  │  │    by reading│
   │              │  │    the code  │
   └──────┬──────┘  │ 3. Output    │
          │         └──────┬───────┘
          │                │
          │                ▼
          │         ┌──────────────┐
          └────────▶│synthesis.json│
                    │              │
                    │ • confirmed  │
                    │   findings   │
                    │ • resolved   │
                    │   disputes   │
                    │ • escalation │
                    │   signals    │
                    │ • scoring    │
                    │ • human      │
                    │   review     │
                    │   items      │
                    └──────────────┘
```

### Why Multiple Models?

Convergence. A single model can miss things or hallucinate. When 5 independent models analyze the same code with the same rubric:

- **3+ models agree** → **Confirmed** finding (high confidence)
- **1-2 models report** → **Potential** finding (flag for human review)
- **Models disagree** → **Dispute** (Claude investigates by reading the code)

This isn't consensus — it's independent verification. Like having 5 auditors review the same books separately, then a senior auditor reconciles their reports.

### Dispute Resolution

When models disagree, Claude doesn't just flag it and move on. It has read access to the codebase and actively investigates:

**Factual disputes** (ground truth exists in the code):
- "Does `.env` contain live API keys?" → Claude reads `.env`, checks the values, checks `.gitignore`. Resolved.
- "Does the app use institutional SSO?" → Claude reads the auth module. Resolved.

**Judgment disputes** (policy interpretation):
- "Does a code sandbox count as auto-completing assignments?" → Claude reads the code, states its recommendation, but flags for human review because it's a policy call.

### The Rubric (10 Sections)

Every model evaluates the same checklist:

| # | Section | What it checks |
|---|---------|---------------|
| 1 | **Inventory** | Languages, frameworks, packages, entry points |
| 2 | **External Services** | Every API, database, cloud service — institutional vs. non-institutional |
| 3 | **Data Operations** | Every data read/write/transmit with sensitivity classification (FERPA, PII, HIPAA, etc.) |
| 4 | **Authentication** | SSO presence, auth bypass mechanisms, hardcoded credential fallbacks |
| 5 | **Secrets** | Every file checked for live keys vs. placeholders, `.gitignore` status verified |
| 6 | **AI Model Usage** | Which AI providers, data transmission to AI, version pinning, training opt-out |
| 7 | **MCP/Agent Security** | MCP configs, skill files, prompt injection, tool poisoning, agentic patterns, guardrails |
| 8 | **Escalation Checks** | 7 binary signals that can force ESCALATE tier regardless of score |
| 9 | **Scoring Signals** | Recommended 0-3 scores on each of the 4 framework dimensions |
| 10 | **Findings** | All issues with defined severity (critical/warning/info) |

### Escalation Conditions

These are binary yes/no checks. Any single trigger can override the composite score and force ESCALATE:

| # | Condition | What triggers it |
|---|-----------|-----------------|
| 1 | Non-institutional cloud | FERPA/PII data sent to third-party cloud without DPA |
| 2 | No institutional SSO | Primary auth isn't UM CAS/Shibboleth |
| 3 | Vendor data access | Third party receives institutional data without legal review |
| 4 | Opaque AI model | AI models used without version pinning or training opt-out |
| 5 | No AI disclosure | Student-facing tool with no disclosure that AI is involved |
| 6 | Auto-completes work | Generates assignments/assessments without faculty oversight |
| 7 | Student behavioral data | Collects student engagement/performance data beyond FERPA scope |

### CLI Tools

Each model runs via its native CLI tool with autonomous filesystem access. No chunking, no sampling — each tool reads every file in the codebase.

| Pass | Model | CLI Tool | Invocation |
|------|-------|----------|------------|
| 1 | GPT-4o | Codex CLI | `codex exec "<prompt>" -C <path> --sandbox read-only` |
| 2 | Gemini 2.5 Pro | Gemini CLI | `gemini -p "<prompt>" -y` (cwd = codebase) |
| 3 | Grok 3 Fast | opencode | `opencode run "<prompt>" -m openrouter/x-ai/grok-code-fast-1` |
| 4 | Kimi K2 | opencode | `opencode run "<prompt>" -m openrouter/moonshotai/kimi-k2` |
| 5 | Qwen3 32B | opencode | `opencode run "<prompt>" -m openrouter/qwen/qwen3-32b` |
| Synth | Claude | Claude Code CLI | `claude -p "<prompt>" --output-format json` (with read tools) |

### Snyk Agent Scan

If the codebase contains MCP server configs or agent skill files, [Snyk agent-scan](https://github.com/snyk/agent-scan) runs automatically (in parallel with the model passes) to check for:

- Prompt injection in tool descriptions
- Tool poisoning (description doesn't match behavior)
- Tool shadowing (tool overrides another)
- Toxic flows (untrusted input → sensitive action)
- Rug pulls (remotely-loaded tools that could change)
- Skill-level threats (malware payloads, untrusted content, credential handling)

Requires `SNYK_TOKEN` in `.env`. Skips gracefully if not configured or no configs found.

## Agent 2: Accessibility / WCAG 2.2 AA (implemented)

Same multi-model architecture as Agent 1. All models get the identical WCAG 2.2 AA audit prompt and independently evaluate the codebase. Claude synthesizes with dispute resolution.

### What It Checks (10 Sections)

| # | Section | Coverage |
|---|---------|----------|
| 1 | **UI Inventory** | Frameworks, component files, form/modal/table/image counts |
| 2 | **WCAG 2.2 AA Criteria** | All Level A and AA success criteria — Perceivable, Operable, Understandable, Robust |
| 3 | **ARIA Deep Audit** | Role correctness, missing labels, invalid patterns, live regions, redundancy |
| 4 | **Keyboard Accessibility** | Focus order, traps, skip nav, tabindex issues, custom key handlers |
| 5 | **Color & Contrast** | Text/background ratios, color-only info, prefers-reduced-motion, forced-colors |
| 6 | **Semantic Structure** | Landmarks, heading hierarchy, table headers, list usage |
| 7 | **Forms & Error Handling** | Label association, error messaging, fieldset/legend, autocomplete |
| 8 | **Images, SVG & Media** | Alt text, decorative marking, SVG roles, captions, transcripts |
| 9 | **Dynamic Content & SPA** | Status announcements, route changes, toast notifications, aria-expanded |
| 10 | **Modals & Dialogs** | Focus trap, escape close, focus restore, aria-modal, inert background |

### Output

- Per-principle scorecard (Perceivable/Operable/Understandable/Robust pass/fail/warning counts)
- Overall conformance estimate (none / partial / substantial / full WCAG 2.2 AA)
- Disputes resolved as **factual** (code says X) or **judgment** (needs manual testing)

---

## Agent 3: HECVAT 4 Lite Self-Assessment (implemented)

Single Claude pass. Reads the codebase + Agent 1 and Agent 2 outputs and pre-populates a HECVAT 4 Lite self-assessment.

[HECVAT](https://www.educause.edu/higher-education-community-vendor-assessment-toolkit) (Higher Education Community Vendor Assessment Toolkit) version 4 is the standard questionnaire used by universities to evaluate tools and services. The "Lite" evaluation covers only the 87 Critical Importance questions.

### What It Covers (23 Categories)

| Category | Questions | What's Assessed |
|----------|-----------|-----------------|
| Documentation | 2 | BCP, DRP |
| IT Accessibility | 4 | VPAT/ACR, WCAG conformance, issue tracking |
| Third Party | 4 | Security assessments, contracts, breach liability |
| Consulting | 4 | Network access, data handling, encryption |
| Application Security | 7 | RBAC, WAF, SAST, dependency currency, separation of duties |
| Authentication | 10 | SSO, MFA, password policies, hardcoded creds, audit logs |
| Change Management | 3 | Notification, customization, config management |
| Data | 8 | Encryption in transit/at rest, FIPS, data ownership, backups |
| Datacenter | 2 | Physical security, power redundancy |
| Firewall/IDS/IPS | 5 | SPI firewall, IDS/IPS, change logging |
| Policies | 3 | Patch management, privacy compliance, jurisdiction |
| Vulnerability Scanning | 3 | Pre-release scanning, scan sharing, institution testing |
| HIPAA | 4 | Training, risk identification, BAAs |
| PCI DSS | 3 | AoC/RoC, PA-DSS, cardholder data |
| Privacy | 7 | Demographic data, biometrics, data combination, law enforcement |
| Data Protection AI | 2 | AI data retention, third-party AI agreements |
| AI Governance | 3 | Risk model, feature disable, responsible AI training |
| AI Policies | 4 | AI risk management, incident disable/re-enable |
| AI Security | 3 | Data removal from models, user input influence, AI logging |
| AI/ML | 2 | Training data separation, feedback verification |
| AI LLM | 4 | LLM privilege limits, training data vetting, human-in-the-loop |

### How It Works

Of the 87 questions, roughly:
- **~35 are answerable from code** — Agent 3 reads the codebase and cites evidence
- **~21 are not applicable** — automatically marked N/A (e.g., HIPAA for non-health tools)
- **~31 require human input** — organizational/contractual questions flagged with specific info needed

The reviewer gets a pre-filled HECVAT where 65% of the work is done.

### Output

- Per-area status counts (yes/no/partial/not_applicable/requires_human_input)
- Readiness percentage: (yes + N/A) / answerable questions
- Non-negotiable failures (SSO, WCAG, encryption, hardcoded passwords)
- High-risk findings with remediation recommendations

---

## Agent 4: Documentation Generation (implemented)

Single Claude pass. Reads the codebase + all prior agent outputs and generates three documents:

| Document | Audience | Content |
|----------|----------|---------|
| **USER_GUIDE.md** | End users (faculty, staff) | Feature walkthrough, common tasks, FAQ, accessibility notes |
| **ADMIN_GUIDE.md** | IT staff | Architecture, installation, config reference, security, troubleshooting |
| **COMPLIANCE_SUMMARY.md** | CIO/CISO/reviewers | Data classification, security posture, WCAG status, risk scores, prioritized actions |

Agent 4 pulls findings from Agents 1-3 into the documentation — security issues go into the admin guide, accessibility gaps go into user-facing notes and the compliance summary, HECVAT gaps go into recommended actions. `[TODO: ...]` placeholders mark anything that can't be determined from code.

---

## Project Structure

```
AIF/
├── README.md                    ← you are here
├── ARCHITECTURE.md              ← original framework architecture spec
├── CLAUDE.md                    ← Claude Code project instructions
├── um-ai-framework.docx        ← framework policy document (v0.1)
├── um-readiness-portal.jsx      ← frontend prototype (React, single-file)
├── um-standards/
│   ├── SKILL.md                 ← Claude skill for UM AI standards
│   └── references/              ← role-specific reference docs
├── backend/
│   ├── package.json
│   ├── .env                     ← API keys (not committed)
│   └── src/
│       ├── index.js             ← CLI entry point
│       ├── orchestrator/
│       │   └── index.js         ← tier-based pipeline orchestration (4 agents)
│       ├── agents/
│       │   ├── shared/
│       │   │   └── cli.js       ← shared CLI execution, JSON extraction, env loading
│       │   ├── code-analysis/
│       │   │   ├── lenses.js    ← analysis prompt, synthesis prompt, output schema
│       │   │   └── runner.js    ← multi-model passes + Snyk integration
│       │   ├── accessibility/
│       │   │   ├── prompts.js   ← WCAG 2.2 AA audit prompt + synthesis prompt
│       │   │   └── runner.js    ← multi-model passes + synthesis
│       │   ├── hecvat/
│       │   │   ├── prompts.js   ← HECVAT 4 Lite (87 critical questions)
│       │   │   ├── runner.js    ← single Claude pass
│       │   │   └── critical_questions.txt  ← extracted from HECVAT 4.15 spreadsheet
│       │   └── documentation/
│       │       ├── prompts.js   ← doc generation prompt (3 documents)
│       │       └── runner.js    ← single Claude pass
│       └── providers/
│           ├── config.js        ← provider definitions (6 models)
│           ├── adapters.js      ← API adapters (used by smoke tests)
│           └── test.js          ← provider smoke test
└── output/                      ← pipeline output (timestamped per run)
    └── <tool>_<timestamp>/
        ├── agent1_code_analysis/
        │   ├── pass1.json .. pass5.json   ← model reports (count varies by tier)
        │   ├── snyk_agent_scan.json       ← Snyk results (if applicable)
        │   └── synthesis.json             ← Claude's merged report
        ├── agent2_accessibility/
        │   ├── pass1.json .. pass5.json   ← model reports
        │   └── synthesis.json             ← merged WCAG audit
        ├── agent3_hecvat/
        │   └── hecvat_assessment.json     ← pre-populated HECVAT 4 Lite
        └── agent4_documentation/
            ├── USER_GUIDE.md              ← end-user documentation
            ├── ADMIN_GUIDE.md             ← IT deployment guide
            ├── COMPLIANCE_SUMMARY.md      ← executive compliance summary
            └── documentation.json         ← all three docs + metadata
```

## Running It

### Prerequisites

CLI tools installed:
- [Codex CLI](https://github.com/openai/codex) (`npm i -g @openai/codex`)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`npm i -g @anthropic-ai/gemini-cli`)
- [opencode](https://opencode.ai) (`go install github.com/opencode-ai/opencode@latest`)
- [Claude Code](https://claude.ai/code) (Anthropic CLI)
- [uv](https://docs.astral.sh/uv/) (for Snyk agent-scan, optional)

### API Keys

Create `backend/.env`:

```bash
OPENAI_API_KEY=sk-...          # Codex CLI
GOOGLE_GENERATIVE_AI_API_KEY=AIza...  # Gemini CLI
OPENROUTER_API_KEY=sk-or-...   # Grok + Kimi + Qwen via OpenRouter
ANTHROPIC_API_KEY=sk-ant-...   # Claude Code CLI (synthesis)
SNYK_TOKEN=...                 # Snyk agent-scan (optional)
```

opencode also needs `/home/zach/opencode.json` with the OpenRouter config (symlinked into target codebases at runtime).

### Usage

```bash
cd /projects/AIF/backend

# Run against a codebase with auto tier (default: DEPLOY = all 5 models)
node src/index.js /projects/some-app

# Specify tier explicitly
node src/index.js /projects/some-app EXPLORE    # 2 models
node src/index.js /projects/some-app PILOT      # 3 models
node src/index.js /projects/some-app DEPLOY     # 5 models
node src/index.js /projects/some-app ESCALATE   # 5 models + human review flag

# Smoke test all providers
npm run test:providers
```

Output goes to `/projects/AIF/output/<tool-name>_<timestamp>/`.

## What's Built vs. Planned

| Component | Status |
|-----------|--------|
| Framework document (v0.1) | Done |
| Frontend prototype (intake wizard, pipeline viz, report view) | Done |
| Agent 1: Code & Security Analysis (multi-model + synthesis + dispute resolution) | Done |
| Snyk agent-scan integration (MCP/agent security scanning) | Done |
| Agent 2: Accessibility / WCAG 2.2 AA (multi-model + synthesis) | Done |
| Agent 3: HECVAT 4 Lite Self-Assessment (87 critical questions) | Done |
| Agent 4: Documentation Generation (User Guide, Admin Guide, Compliance Summary) | Done |
| Final compilation pass (cross-agent synthesis) | Planned |
| Database (PostgreSQL) | Planned |
| Frontend ↔ Backend integration | Planned |
| MCP connectors (repo, project tracker, docs) | Planned |

## Example Output

From a recent EXPLORE run (2 models) against `llm-compare`:

```
Convergence: 5 confirmed, 5 potential, 3 resolved, 2 needs_human_review

Escalation signals triggered:
  🚨 nonInstitutionalCloudWithData (2/2 models)
  🚨 vendorDataAccessNoDPA (2/2 models)
  🚨 opaqueAIModel (2/2 models)
  🚨 autoCompletesAssignments (1/2 — disputed, needs human review)

Scoring: Data=2, Blast=2, Autonomy=1, Comprehension=2 → Composite 7 → DEPLOY

Disputes resolved by reading code:
  ✓ opencode.json API key confirmed exposed and not gitignored
  ✓ .env live keys confirmed present (gitignored but on disk)
  ✓ Autonomy scored 1 (auto-save is side-effect, not autonomous action)
```
