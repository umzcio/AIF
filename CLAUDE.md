# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AI Production Readiness Framework (AIF)** — A risk-tiered governance framework and review portal for moving AI-assisted tools from prototype to production at the University of Montana. Developed by the CIO's office for internal use and portability to other institutions.

The portal is the enforcement/automation layer: builders submit tools via a 21-question intake form, the system scores them on seven weighted dimensions, routes them to a Track (1–4), runs a uniform 5-model agent pipeline, and produces structured reports with auto-generated documentation.

## Repository Structure

- `ARCHITECTURE.md` — Full architecture spec and design document (the authoritative source for portal behavior, agent pipeline design, scoring model, track routing, escalation conditions, multi-pass convergence, and build sequence)
- `um-ai-built-tool-intake.docx` — The framework policy document (v1.0)
- `ai-tool-intake-platform.jsx` — Frontend prototype (single-file React component)
- `um-standards/SKILL.md` — Claude skill definition for UM organizational AI standards (compliance triage, data handling, WCAG, NIST CSF)
- `um-standards/references/` — Role-specific reference files (it-staff.md, faculty-research.md, admin-staff.md)
- `backend/` — Agent pipeline backend (Node.js, ESM)
- `frontend/` — Vite+React frontend (CSS classes, component-per-file)

## Backend (`backend/`)

### Commands
- `npm run dev` — Start with file watching
- `npm run test:providers` — Smoke test all 6 LLM providers
- `node src/index.js <codebase-path> [track]` — Run full pipeline against a codebase (TRACK_1..TRACK_4, default TRACK_3)

### Multi-Model Agent Architecture

Each agent pass is executed by a **different AI model via its native CLI tool**, not raw API calls. The CLI tools (Codex, Gemini CLI, opencode) have full filesystem access and explore the codebase autonomously — reading files, grepping, following imports. No chunking needed.

**Pass roster (5 models, same prompt):**

All 5 models receive the SAME comprehensive analysis prompt. Each independently reviews the entire codebase. Convergence comes from comparing their independent findings.

| Pass | Model | CLI Tool |
|------|-------|----------|
| 1 | OpenAI GPT-4o | Codex CLI |
| 2 | Gemini 2.5 Pro | Gemini CLI |
| 3 | Grok 3 Fast | opencode (OpenRouter) |
| 4 | Kimi K2 | opencode (OpenRouter) |
| 5 | Qwen3 32B | opencode (OpenRouter) |
| Synthesis | Claude | Claude Code CLI |

No model reviews its own work. Claude only synthesizes — it never runs a pass. Synthesis uses Claude Code CLI (not raw API) so it has the same filesystem access as the other tools.

**All tracks run all 5 models.** The pipeline is uniform — track determines governance requirements, not analysis depth.

**API keys needed (in `backend/.env`):**
- `OPENAI_API_KEY` — OpenAI direct (Codex)
- `GOOGLE_GENERATIVE_AI_API_KEY` — Gemini direct
- `OPENROUTER_API_KEY` — Grok + Kimi + Qwen via OpenRouter
- `ANTHROPIC_API_KEY` — Claude Code CLI (synthesis)

### Agent Pipeline (4 agents, all implemented)

| Agent | Type | What it does |
|-------|------|-------------|
| 1: Code & Security | Multi-model (5 passes + Claude synthesis) | 10-section rubric: inventory, services, data ops, auth, secrets, AI usage, MCP/agent security, escalation checks, scoring (7 dimensions), findings |
| 2: Accessibility | Multi-model (5 passes + Claude synthesis) | WCAG 2.2 AA audit: ARIA, keyboard, contrast, structure, forms, images, dynamic content, modals, responsive |
| 3: HECVAT 4 Lite | Single Claude pass (reads Agent 1+2 output) | 87 Critical Importance questions from HECVAT 4.15 across 23 categories |
| 4: Documentation | Single Claude pass (reads Agent 1-3 output) | Generates USER_GUIDE.md, ADMIN_GUIDE.md, COMPLIANCE_SUMMARY.md |

### Key Files
- `src/scoring.js` — Shared scoring module (weight profiles, dimension scores, escalation checks, track routing)
- `src/agents/shared/cli.js` — Shared CLI execution, JSON extraction, env loading (used by all agents)
- `src/agents/code-analysis/lenses.js` — Code analysis prompt + synthesis prompt + output schema (7-dimension scoring signals)
- `src/agents/code-analysis/runner.js` — Multi-model passes + Snyk integration
- `src/agents/accessibility/prompts.js` — WCAG 2.2 AA audit prompt + synthesis prompt + accessibility scoring signal
- `src/agents/accessibility/runner.js` — Multi-model passes + synthesis
- `src/agents/hecvat/prompts.js` — HECVAT 4 Lite prompt (87 critical questions)
- `src/agents/hecvat/runner.js` — Single Claude pass, reads prior agent outputs
- `src/agents/documentation/prompts.js` — Documentation generation prompt (3 documents)
- `src/agents/documentation/runner.js` — Single Claude pass, reads all prior agent outputs
- `src/orchestrator/index.js` — Pipeline orchestration (runs all 4 agents sequentially, uniform 5-model passes)
- `src/pipeline/queue.js` — Job queue with SSE progress streaming
- `src/server.js` — Express HTTP API
- `src/routes/intake.js` — Intake routes (draft/submit, computes scores from raw answers)
- `src/routes/registry.js` — Registry routes (list/filter by track)
- `src/routes/pipeline.js` — Pipeline routes (start run, SSE stream)
- `src/providers/config.js` — Provider definitions (used by smoke tests)
- `src/providers/adapters.js` — API adapters (used by smoke tests)

## Frontend (`frontend/`)

Vite+React app with CSS class-based styling. Components in `frontend/src/components/`.

### Commands
- `npm run dev` — Start dev server
- `npm run build` — Production build

### Key Components
- `App.jsx` — Root; TopBar shell, routes to views (welcome, registry, intake, upload, detail, pipeline, report, framework)
- `TopBar.jsx` — Horizontal tab bar (Home, Registry, Submit, Framework) + user avatar
- `Welcome.jsx` — Landing page with submit/registry cards, track overview, pipeline summary
- `IntakeForm.jsx` — 21-question form with live scoring sidebar; computes track in real-time
- `CodeUpload.jsx` — Drag-and-drop file upload, starts pipeline run
- `Registry.jsx` — Tool registry table with track/status filters
- `Pipeline.jsx` — Agent pipeline progress (4 agents, 5/5/1/1 passes, SSE streaming)
- `Report.jsx` — Structured findings report with 7 dimension scores and weighted percentage
- `ToolDetail.jsx` — Tool detail page with dimension scores, track, artifact type
- `FrameworkDoc.jsx` — 12-section framework reference with sticky TOC sidebar

### Constants and Scoring (`constants.js`)
- `WEIGHT_MATRIX` — 6 artifact types × 7 dimensions (weight profiles)
- `AGENTS` — 4 agent definitions with icons/colors
- `SEVERITY_CONFIG` — severity display config
- `TRACK_COLORS` / `TRACK_LABELS` — Track 1-4 display metadata
- `DIMENSION_LABELS` / `DIMENSION_SHORT` — 7 dimension display names
- `computeDimensionScores(answers)` — derive 7 scores from 21 answers
- `checkEscalations(answers)` — detect escalation conditions
- `computeTrack(answers)` — weighted % routing to Track 1-4

### Design Conventions
- CSS classes in `styles.css` (no inline styles)
- Font: DM Sans / JetBrains Mono
- Track color scheme: green (Track 1) → gold (Track 2) → orange (Track 3) → red (Track 4)
- Components use the `C` constant for colors — never hardcode hex values directly

## Tech Stack

- **Frontend**: React + Vite (consistent with UnifyIT ecosystem)
- **Backend**: Node.js (ESM), PostgreSQL
- **Auth**: CAS via login.umt.edu, JWT cookies
- **AI**: 5 models via CLI tools (Codex, Gemini CLI, opencode) + Claude API for synthesis
- **APIs**: OpenAI, Google, xAI direct; Kimi + Qwen via OpenRouter; Claude via Anthropic
- **Infrastructure**: Docker (multi-stage build + docker-compose with postgres)
- **Future**: AWS Bedrock for Claude, MCP connectors for repo/project tracker/docs integration

## Framework Domain Rules

These are non-negotiable business rules from the framework that code must enforce:

### Scoring Model — 7 Weighted Dimensions (0–3 each)

1. **Security** (0–3): Secrets, auth, input validation, dependencies, encryption
2. **Accessibility** (0–3): Semantic HTML, ARIA, keyboard, contrast
3. **Data Sensitivity** (0–3): No data → HIPAA/FERPA/export-controlled
4. **Blast Radius** (0–3): Builder only → institution-wide
5. **Autonomy** (0–3): Fully manual → autonomous decisions
6. **Comprehension** (0–3): Builder understands fully → can't explain AI code
7. **Maintenance** (0–3): Test coverage, docs, dependency freshness, error handling

### Weight Profiles by Artifact Type

Scores are weighted by artifact type (public-site, internal-app, script-api, ai-agent, data-pipeline, other). Each type has a different weight profile across the 7 dimensions.

### Track Routing (weighted percentage)

| Weighted % | Track | Action |
|------------|-------|--------|
| < 22% | Track 1 — Register & Go | Register in institutional registry |
| 22–42% | Track 2 — Self-Certify | Complete self-assessment, owner sign-off |
| 42–65% | Track 3 — IT Review | Submit to IT/security review |
| ≥ 65% | Track 4 — Formal Project | Formal IT project governance |

### Escalation Conditions (override score → Track 4)

7 conditions that force Track 4 regardless of weighted percentage:
- Regulated data (HIPAA/FERPA/export-controlled) with public exposure
- FERPA data in public-facing tool
- Personal accounts for institutional data
- No DPA for third-party data processing
- Custom authentication (not institutional SSO)
- No version control
- Students unaware they're interacting with AI

### Pipeline Rules

- All tracks run the same 5-model pipeline — track determines governance, not analysis depth
- Multi-model agents (1, 2): 5 passes each; single-pass agents (3, 4): 1 pass each
- Finding confirmed if flagged in 3+ passes; potential if 1–2 passes; clean if 0
- Agents recommend track changes — humans confirm at launch

## Style and Approach

- Direct, no fluff. Say what it does, not what it aspires to do.
- If something isn't built yet, say so explicitly.
- Proportionality is the core principle: scrutiny scales with risk.
- The portal serves two audiences: builders who need to know what to do, and reviewers who need findings they can act on.
