# AI Production Readiness Framework — Review Portal

## Project Context

This project builds a **review portal** that operationalizes the AI Production Readiness Framework — a risk-tiered routing framework for moving AI-assisted tools from prototype to production in higher education. The framework was developed by the University of Montana CIO's office and is designed to be both internally adoptable and portable to other institutions.

The portal is the enforcement and automation layer for the framework. Builders submit tools via a 21-question intake form, the system scores them on 7 weighted dimensions, routes them to a Track (1–4), runs a uniform 5-model agent pipeline, and the output is a structured report with auto-generated documentation.

## The Framework (Summary)

The full framework document (`um-ai-built-tool-intake.docx`) is the authoritative source. Key elements the portal must implement:

### Scoring Model — Seven Weighted Dimensions (0–3 each)

1. **Security** (0–3): No external exposure (0) → Hardcoded secrets, no auth, unvalidated inputs (3)
2. **Accessibility** (0–3): Not applicable / fully compliant (0) → No semantic HTML, no ARIA, no keyboard support (3)
3. **Data Sensitivity** (0–3): No data (0) → HIPAA/FERPA/export-controlled (3)
4. **Blast Radius** (0–3): Builder only (0) → Institution-wide/core enterprise systems (3)
5. **Autonomy** (0–3): Fully manual (0) → Autonomous decisions without human review (3)
6. **Comprehension** (0–3): Builder understands all code fully (0) → AI-generated, builder can't explain (3)
7. **Maintenance** (0–3): Full test coverage and docs (0) → No tests, no docs, stale dependencies (3)

### Weight Profiles by Artifact Type

Each artifact type has a different weight profile across the 7 dimensions:

| Artifact Type | Security | Accessibility | Data Sensitivity | Blast Radius | Autonomy | Comprehension | Maintenance |
|---------------|----------|---------------|-----------------|--------------|----------|---------------|-------------|
| Public Site | 3 | 4 | 2 | 3 | 1 | 2 | 2 |
| Internal App | 3 | 3 | 3 | 2 | 2 | 2 | 2 |
| Script/API | 4 | 1 | 3 | 2 | 2 | 3 | 3 |
| AI Agent | 3 | 1 | 3 | 3 | 4 | 3 | 2 |
| Data Pipeline | 3 | 1 | 4 | 3 | 3 | 2 | 3 |
| Other | 3 | 2 | 3 | 2 | 2 | 2 | 2 |

Weighted percentage = (Σ score × weight) / (3 × Σ weight) × 100

### Track Routing

| Weighted % | Track | Label | Action |
|------------|-------|-------|--------|
| < 22% | 1 | Register & Go | Register in institutional registry, assign owner |
| 22–42% | 2 | Self-Certify | Complete self-assessment, confirm owner sign-off, schedule recurring self-certification |
| 42–65% | 3 | IT Review | Submit to IT/security review, resolve warnings before production, annual re-scan |
| ≥ 65% | 4 | Formal Project | Formal IT project governance, pause production until review complete, human review checkpoints |

### Escalation Conditions (override score → Track 4)

7 conditions that force Track 4 regardless of weighted percentage:

1. **Regulated data + public exposure** — Tool handles HIPAA/FERPA/export-controlled data and is publicly accessible
2. **FERPA + public** — FERPA-protected data in a public-facing tool
3. **Personal accounts** — Institutional data stored in personal/non-institutional accounts
4. **No DPA** — Third-party processes institutional data without a Data Processing Agreement
5. **Custom auth** — Authentication outside institutional SSO/IdP
6. **No version control** — No version control system in use
7. **Students unaware** — Students don't know they're interacting with or being evaluated by AI

### Multi-Tool Pipeline Composition

Tools operating as a connected pipeline (shared data, passed outputs, coordinated actions) must be scored as a system, not just individually. Higher score governs. A pipeline exists when combined capability exceeds any individual tool.

### Material Change (triggers re-review)

- New data sources or data categories
- New user populations
- AI model or provider change (including provider-side version updates)
- New system integrations or APIs
- Authentication method change
- Hosting environment or data residency change
- Score increase that changes track routing

Non-material: bug fixes, UI improvements, performance optimizations that don't alter data handling, users, AI model, integrations, or auth.

### Post-Production Monitoring

- All tools registered in tool registry with owner and approved version
- Track 2: annual owner self-certification
- Track 3: annual re-scan (automated where possible, manual with documented results where not)
- Track 4: annual formal IT review
- Owner departure: 30-day grace period to transfer ownership before suspension
- Third-party AI model owners must monitor provider changelogs; provider-side model updates are material changes

### Ethical Principles (EDUCAUSE AI Ethical Guidelines 2025)

- **Beneficence**: Who benefits and is it real/equitable?
- **Respect for Autonomy**: Do affected people know the tool exists and what it does?
- **Transparency/Explainability**: Can someone other than the builder explain it? (Comprehension dimension)
- **Accountability**: Named owner responsible; cannot delegate to AI (ownership/registry requirements)

### Existing Tools Onboarding

- 90-day amnesty window from policy publication
- Track 1: register only
- Track 2: complete self-assessment within 90 days or suspend
- Track 3/4: report to IT immediately, remediation timeline agreed
- No owner identified within 30 days: suspend
- Post-window discovery: standard framework immediately, no grace period

---

## Portal Architecture

### Intake Layer

Builder-facing interface. 21-question guided intake form organized into sections:

1. **Basic Info** — Tool name, description, artifact type (public-site, internal-app, script-api, ai-agent, data-pipeline, other)
2. **Security** — External exposure, authentication method, input validation, secrets management
3. **Data & Privacy** — Data categories handled, storage location, third-party sharing, DPA status
4. **Deployment & Access** — User population, blast radius, version control, hosting
5. **AI-Specific** (conditional — shown only for ai-agent artifact type) — Model autonomy, human oversight, comprehension of AI-generated code
6. **Maintenance** — Test coverage, documentation, dependency management, error handling

The intake computes:
- 7 dimension scores (0–3 each) derived from answers
- Weighted percentage based on artifact type weight profile
- Escalation condition checks
- Track routing (1–4)

Live scoring sidebar shows track preview as the builder answers questions.

### Agent Pipeline

Four specialist agents plus an orchestrator. Each agent has a narrow scope. Agents run in a dependency-aware sequence.

#### Agent 1: Code & Security Analysis
- **Scope**: Structural and security analysis of the codebase
- **Type**: Multi-model (5 passes + Claude synthesis)
- **Reads**: Uploaded code / connected repo
- **Produces**: 10-section analysis (inventory, services, data ops, auth, secrets, AI usage, MCP/agent security, escalation checks, 7-dimension scoring signals, findings)
- **Scoring signals**: Security, Accessibility, Data Sensitivity, Blast Radius, Autonomy, Comprehension, Maintenance (each 0–3 with reasoning)
- **Output feeds**: All downstream agents

#### Agent 2: Accessibility
- **Scope**: WCAG 2.2 AA accessibility audit
- **Type**: Multi-model (5 passes + Claude synthesis)
- **Reads**: Code Analysis Agent output + source code
- **Produces**: WCAG conformance report (ARIA, keyboard, contrast, structure, forms, images, dynamic content, modals, responsive) + accessibility scoring signal (0–3)
- **Output feeds**: Agents 3 and 4

#### Agent 3: HECVAT 4 Lite
- **Scope**: Higher Education Community Vendor Assessment Toolkit
- **Type**: Single Claude pass (reads Agent 1+2 output)
- **Reads**: Agent 1 and 2 outputs + source code
- **Produces**: 87 Critical Importance questions from HECVAT 4.15 across 23 categories (~35 answerable from code, ~21 N/A, ~31 require human input — reviewer gets ~65% pre-filled)
- **Output feeds**: Agent 4

#### Agent 4: Documentation
- **Scope**: Auto-generate admin guide, user guide, and compliance summary
- **Type**: Single Claude pass (reads Agent 1-3 output)
- **Reads**: Outputs from all previous agents
- **Produces**: USER_GUIDE.md, ADMIN_GUIDE.md, COMPLIANCE_SUMMARY.md

#### Orchestrator
- All tracks run the same pipeline — 5 models for multi-model agents, 1 pass for single-pass agents
- Runs all 4 agents sequentially (Agent 1 → 2 → 3 → 4)
- Collects all outputs, checks for escalation condition triggers
- Produces final determination

### Multi-Pass Convergence

Multi-model agents (1, 2) run 5 independent passes with different AI models. Each model explores the codebase autonomously via CLI tools with filesystem access.

**Consensus scoring:**
- Finding flagged by 3+ models: **confirmed finding**
- Finding flagged by 1–2 models: **potential finding, requires human review**
- Finding flagged by 0 models: **clean**

**Convergence report:** After all passes, Claude synthesizes findings across models. Output includes confidence scores and divergence flags. Divergent items need human eyes. Convergent items can be trusted.

**Parallelization:** All 5 model passes are independent and run in parallel. Synthesis requires all pass outputs. Agents 1 and 2 are independent and could run concurrently (currently sequential).

### Output Layer

Builder receives a structured report:
- Track determination with weighted percentage
- 7 dimension scores with explanations
- Escalation conditions checked
- Agent findings with severity and model agreement
- Auto-generated admin guide, user guide, and compliance summary
- HECVAT 4.15 pre-filled responses
- Confidence scores on each finding
- Divergence flags for human review items

For Track 2: report informs the self-certification process.
For Track 3/4: report feeds human review process with all prep work done.

### Registry Integration

Every tool completing the pipeline is registered automatically:
- Tool name, artifact type, owner, track, weighted percentage, date
- 7 dimension scores
- Findings summary
- Links to generated documentation
- Baseline for future material change comparison

When builder returns with a material change, system compares new analysis against stored baseline and flags what changed.

---

## Technology Stack

- **Frontend**: React + Vite (consistent with UnifyIT ecosystem)
- **Backend**: Node.js (ESM) / PostgreSQL
- **Auth**: CAS via login.umt.edu, JWT cookies
- **AI**: 5 models via CLI tools (Codex, Gemini CLI, opencode) + Claude Code CLI for synthesis
- **APIs**: OpenAI, Google, xAI direct; Kimi + Qwen via OpenRouter; Claude via Anthropic
- **Infrastructure**: Docker (multi-stage Dockerfile + docker-compose with postgres)
- **Proxy**: Nginx reverse proxy at `/aif/` path
- **Future**: AWS Bedrock for Claude, MCP connectors for repo/project tracker/docs integration

## Database Schema

PostgreSQL with migrations in `backend/migrations/001_init.sql`:

### `tools` table
- `id`, `name`, `description`, `artifact_type`, `status` (draft/pending/reviewing/completed/archived)
- `intake_answers` (JSONB — raw 21 answers)
- 7 score columns: `score_security`, `score_accessibility`, `score_data_sensitivity`, `score_blast_radius`, `score_autonomy`, `score_comprehension`, `score_maintenance` (INTEGER 0–3, nullable)
- `weighted_percentage` (NUMERIC 5,2)
- `track` (INTEGER 1–4)
- `has_escalation` (BOOLEAN)
- `codebase_path`, `submission_type`, `submitted_by`, `created_at`, `updated_at`

### `pipeline_runs` table
- `id`, `tool_id` (FK), `track` (INTEGER), `status`, `queued_at`, `started_at`, `completed_at`

### `agent_results` table
- `id`, `run_id` (FK), `agent_key`, `pass_index`, `model_id`, `status`, `result_json`, `started_at`, `completed_at`

### `users` table
- `id`, `net_id`, `display_name`, `email`, `role` (admin/reviewer/builder)

## Critical Design Principles

- **All tracks get the same analysis depth.** The pipeline is uniform — 5 models always. Track determines governance requirements (register, self-certify, IT review, formal project), not how many models review.
- **False positives erode trust fast.** Tune for precision over recall at launch; add sensitivity later.
- **The framework's authority comes from the process, not the automation.** The portal accelerates the process; it doesn't replace institutional judgment.
- **Proportionality applies to governance, not analysis.** Every tool gets thorough analysis. What differs is the required response.
- **$50 in tokens to catch a FERPA exposure that could cost six figures is not a conversation.** Design for thoroughness. Token costs drop; institutional risk doesn't.

## Style and Approach

- Direct, no fluff. Say what it does, not what it aspires to do.
- If something isn't built yet, say so explicitly — don't paper over gaps.
- Proportionality is the core principle: scrutiny scales with risk, in the framework and in the portal.
- The portal serves two audiences: builders who need to know what to do, and reviewers who need findings they can act on.
