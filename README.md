# AI-Built Tool Code Intake Framework (AIF)

A risk-tiered governance framework and review portal for moving AI-assisted tools from prototype to production at the University of Montana.

Builders submit tools via a 21-question intake form → the system scores them on 7 weighted dimensions → routes them to a Track (1–4) → runs a uniform 5-model agent pipeline → produces structured reports with findings, HECVAT assessment, and auto-generated documentation.

## How It Works

```
┌──────────────────────────────────────────────────────────────────┐
│                          INTAKE                                  │
│                                                                  │
│  21-question form → 7-dimension scoring → Track assignment       │
│                                                                  │
│  Security (0-3)          ─┐                                      │
│  Accessibility (0-3)     ─┤                                      │
│  Data Sensitivity (0-3)  ─┤                                      │
│  Blast Radius (0-3)      ─┤─→ Weighted % ─→ Track 1-4            │
│  Autonomy (0-3)          ─┤   (by artifact type)                 │
│  Comprehension (0-3)     ─┤   + escalation override              │
│  Maintenance (0-3)       ─┘                                      │
│                                                                  │
│  <22% → Track 1    22-42% → Track 2    42-65% → Track 3          │
│  Register & Go     Self-Certify        IT Review                 │
│                                                 ≥65% → Track 4   │
│                                                 Formal Project   │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                      AGENT PIPELINE                              │
│                                                                  │
│  All tracks run the same pipeline — uniform 5-model analysis     │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Agent 1  │  │ Agent 2  │  │ Agent 3  │  │ Agent 4  │          │
│  │ Code &   │  │ Access-  │  │ QA / Bug │  │Docs +    │          │
│  │ Security │  │ ibility  │  │Detection │  │ HECVAT   │          │
│  │          │  │          │  │          │  │          │          │
│  │ 5 models │  │ 5 models │  │ 5 models │  │3 parallel│          │
│  │+synthesis│  │+synthesis│  │+synthesis│  │ models   │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
│       │             │             │              │               │
│       └──────┬──────┘             │              │               │
│              │           reads 1+2       reads 1-3              │
│              │                                                   │
│              ▼                                                   │
│  ┌────────────────────────────────────────────────────────┐      │
│  │  Claude Synthesis + Dispute Resolution                 │      │
│  │  3+ models agree → confirmed                           │      │
│  │  1-2 models → potential                                │      │
│  │  0 models → clean                                      │      │
│  └────────────────────────────────────────────────────────┘      │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                      REVIEW WORKFLOW                              │
│                                                                  │
│  Track 1 → auto-activate on pipeline completion                  │
│  Track 2 → builder self-certifies                                │
│  Track 3-4 → reviewer approves / requests changes                │
│                                                                  │
│  Admins: dashboard, user management, audit log, track override   │
│  Pipeline: cancel, retry, per-model timeouts, dead letter queue  │
│  Analytics: per-model metrics, cost tracking, convergence stats  │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                         OUTPUT                                   │
│  Security findings · A11y audit · QA / Bugs · HECVAT XLSX        │
│  User Guide · Admin Guide · Compliance Summary (.docx)           │
└──────────────────────────────────────────────────────────────────┘
```

## Scoring Model

### 7 Weighted Dimensions (0–3 each)

| Dimension | What it measures |
|-----------|-----------------|
| **Security** | Secrets, auth, input validation, dependencies, encryption |
| **Accessibility** | Semantic HTML, ARIA, keyboard, contrast |
| **Data Sensitivity** | No data → HIPAA/FERPA/export-controlled |
| **Blast Radius** | Builder only → institution-wide exposure |
| **Autonomy** | Fully manual → autonomous decisions |
| **Comprehension** | Builder understands fully → can't explain AI code |
| **Maintenance** | Test coverage, docs, dependency freshness |

### Weight Profiles by Artifact Type

Each artifact type has a different weight profile. A public website weights accessibility heavily; an AI agent weights autonomy and blast radius.

| Artifact Type | SEC | A11Y | DATA | BLAST | AUTO | COMP | MAINT |
|--------------|-----|------|------|-------|------|------|-------|
| Public Site | 4 | 4 | 3 | 3 | 1 | 2 | 3 |
| Internal App | 3 | 3 | 4 | 2 | 1 | 2 | 3 |
| Script/API | 3 | 0 | 3 | 2 | 2 | 2 | 3 |
| AI Agent | 3 | 1 | 3 | 4 | 4 | 4 | 3 |
| Data Pipeline | 3 | 0 | 4 | 2 | 2 | 2 | 3 |
| Other | 3 | 2 | 3 | 2 | 1 | 2 | 3 |

**Weighted % = Σ(score × weight) / (3 × Σweight) × 100**

### Escalation Conditions (override → Track 4)

Any of these force Track 4 regardless of weighted percentage:

1. Regulated data (HIPAA/IRB/export-controlled/tribal) present
2. FERPA data in a public-facing tool
3. Institutional data in personal accounts
4. AI model without approved DPA
5. Auth outside campus SSO
6. No version control
7. Students unaware they're interacting with AI

## Agent Pipeline

### Two-Layer Architecture

AI models are good at reasoning about architecture, intent, and context. They're bad at exhaustive mechanical checking — verifying that every `<input>` has a `<label>`, that every dependency is free of known CVEs, that no file contains a SQL injection pattern. Each model pass is a fresh read with no persistent state.

The pipeline is designed around this limitation:

- **Layer 0 — Deterministic Tooling:** SAST scanners, linters, and dependency auditors that mechanically check every element against known rule sets. High precision, exhaustive coverage of what they check. Runs in parallel with model passes (no added latency).
- **Layer 1 — Multi-Model AI:** Five AI models reason about what tools can't — business logic flaws, architecture concerns, auth flow correctness, and "does this actually make sense?" judgment calls. Claude synthesizes everything with filesystem access for dispute resolution.

Three confidence tiers in output:

| Tier | Meaning |
|------|---------|
| **Tool-Verified** | Deterministic scanner, verified against known rules |
| **Confirmed** | 3+ AI models independently agree |
| **Potential** | 1–2 models flagged, needs human review |

### Layer 0: Deterministic Tools

All tools run in parallel with model passes. Findings are merged into synthesis with `toolVerified: true`.

| Tool | Agent | What it checks |
|------|-------|---------------|
| Semgrep | 1 | OWASP Top 10 + default SAST rules (SQLi, XSS, command injection, insecure patterns) |
| npm audit / pip-audit | 1 | Known dependency CVEs against advisory databases |
| Snyk Agent Scan | 1 | MCP config and SKILL.md security threats |
| eslint-plugin-jsx-a11y | 2 | Static React/JSX accessibility (34 rules: alt text, labels, ARIA, keyboard) |
| ESLint QA | 3 | Dead code, unused variables, unreachable code, async bugs, type safety |

### Agent 1: Code & Security Analysis

Multi-model (5 passes + Claude synthesis + stack-specific deep dive). 10-section rubric: technology inventory, external services, data operations, authentication, secrets, AI/ML usage, MCP/agent security, escalation checks, 7-dimension scoring signals, prioritized findings. After synthesis, a second Claude pass runs framework-specific security checklists (React, Express, Spring, Django, Phoenix, Postgres, MongoDB, AI/ML, Docker) tailored to the detected stack.

**Integrated tools:** Semgrep (SAST), npm audit / pip-audit (dependency CVEs), Snyk Agent Scan (MCP/skill security).

### Agent 2: Accessibility Audit

Multi-model (5 passes + Claude synthesis). WCAG 2.2 Level AA audit: ARIA, keyboard navigation, color contrast, semantic structure, forms, images, dynamic content, modals, responsive design.

**Integrated tools:** eslint-plugin-jsx-a11y (static React/JSX accessibility linting, 34 rules).

### Agent 3: QA / Bug Detection

Multi-model (5 passes + Claude synthesis). Finds logic bugs, correctness issues, and quality problems: null handling, error paths, async/concurrency, edge cases, type safety, resource management, API contract violations, state management, failure modes. Reads Agent 1+2 output for context.

**Integrated tools:** ESLint QA (dead code, unused vars, unreachable code, async patterns, type coercion).

### Agent 4: Documentation + HECVAT

3 parallel passes (Gemini 3.1 Pro + GLM-5 + Claude, reads Agent 1-3 output). Gemini produces the User Guide and Admin Guide, GLM-5 handles the HECVAT self-assessment, and Claude produces the Compliance Summary. Outputs converted from Markdown to .docx via Pandoc; HECVAT fills the official EDUCAUSE Excel template.

### Multi-Model Convergence (Layer 1)

Five different AI models receive the **same prompt** and independently analyze the entire codebase:

| Pass | Model | CLI Tool | Why |
|------|-------|----------|-----|
| 1 | GPT-5.4 | Codex CLI | Structured reasoning, logical vulnerability detection |
| 2 | MiniMax M2.5 | opencode | Large-context reasoning, cross-file dependency analysis |
| 3 | MiMo-V2-Flash | opencode | Fast reasoning model, code and math optimization |
| 4 | Kimi K2 | opencode | 1T MoE architecture, edge case detection |
| 5 | GLM-5 | opencode | Agent-optimized model, deep code understanding |
| Synth | Claude Opus 4.6 | Claude Code | Synthesis only — dispute resolution with filesystem access |

No model reviews its own work. Claude only synthesizes — it never runs a pass. The codebase is extracted into an isolated Docker container for security.

## Review Workflow & RBAC

Three roles: **builder**, **reviewer**, **admin**.

| Role | Capabilities |
|------|-------------|
| Builder | Submit intake, upload code, view own tools, self-certify (Track 2) |
| Reviewer | Everything builder can do + review any tool, approve/reject, track override |
| Admin | Everything reviewer can do + user management, audit log, system dashboard |

### Status Flow

```
draft → pending → in_progress → under_review → approved → active
                                     ↓
                              changes_requested → under_review (resubmit)
```

- **Track 1**: Auto-activates on pipeline completion (no review needed)
- **Track 2**: Builder self-certifies after reviewing findings
- **Track 3–4**: Reviewer approves or requests changes
- **Track override**: Reviewers/admins can escalate or de-escalate with documented reason
- All status changes and decisions are recorded in the audit log

## Security

- **Helmet** security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, etc.)
- **CSRF** protection via double-submit cookie pattern
- **Rate limiting** (30/15min auth, 120/min API)
- **JWT** cookies with required secret, refresh endpoint
- **Non-root Docker** container with dedicated `aif` user
- **Input validation** — pagination caps, query param sanitization, body size limits (1MB)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite, CSS design system (light + dark mode), WCAG 2.2 AA |
| Backend | Node.js (ESM), Express, PostgreSQL |
| Auth | CAS via login.umt.edu, JWT cookies, RBAC (builder/reviewer/admin) |
| AI Models | 5 models via CLI tools + Claude synthesis |
| APIs | OpenAI, Google direct; MiniMax + MiMo + Kimi + GLM via OpenRouter |
| Infrastructure | Docker (multi-stage build + docker-compose) |

## Project Structure

```
AIF/
├── Dockerfile                       ← Multi-stage build (frontend + backend)
├── docker-compose.yml               ← App + PostgreSQL
├── hecvat415.xlsx                   ← HECVAT 4.15 template
├── backend/
│   ├── migrations/                  ← SQL schema (init, RBAC, review, notifications, pipeline, analytics)
│   ├── src/
│   │   ├── index.js                ← CLI entry point
│   │   ├── server.js               ← Express HTTP API (helmet, CSRF, rate limiting)
│   │   ├── scoring.js              ← Shared scoring module (7 dimensions, weights, tracks)
│   │   ├── audit.js                ← Audit logging helper
│   │   ├── notifications.js        ← In-app + email notification delivery
│   │   ├── orchestrator/
│   │   │   ├── opencode.js        ← Default pipeline orchestration (opencode agent definitions)
│   │   │   └── index.js           ← Legacy fallback orchestration (direct CLI spawns)
│   │   ├── pipeline/
│   │   │   ├── queue.js            ← Job queue, SSE streaming, cancel/retry, pass metrics
│   │   │   └── events.js           ← SSE event emitter
│   │   ├── agents/
│   │   │   ├── shared/cli.js       ← CLI execution, JSON extraction, per-model timeouts, process tracking
│   │   │   ├── code-analysis/      ← Agent 1 (prompts + runner)
│   │   │   ├── accessibility/      ← Agent 2 (prompts + runner)
│   │   │   ├── qa-analysis/         ← Agent 3 (prompts + runner)
│   │   │   └── documentation/      ← Agent 4 (prompts + runner + HECVAT + XLSX export)
│   │   ├── routes/
│   │   │   ├── auth.js             ← CAS login, JWT, refresh
│   │   │   ├── intake.js           ← Draft/submit, score computation
│   │   │   ├── pipeline.js         ← Start run, SSE stream, cancel, retry
│   │   │   ├── registry.js         ← Role-scoped listing, status transitions
│   │   │   ├── reports.js          ← Agent results, report download
│   │   │   ├── review.js           ← Review decisions, notes, self-certify
│   │   │   ├── admin.js            ← Dashboard stats, user management, audit log
│   │   │   ├── analytics.js        ← Pipeline performance, model metrics, cost trends
│   │   │   └── notifications.js    ← Notification CRUD, preferences, email
│   │   ├── auth/                   ← CAS auth, JWT, RBAC middleware
│   │   └── db/                     ← PostgreSQL pool + migration runner
├── frontend/
│   ├── vite.config.js
│   ├── src/
│   │   ├── App.jsx                 ← Root shell, routing, role guards
│   │   ├── constants.js            ← Scoring engine, color palette, metadata
│   │   ├── styles.css              ← CSS design system (light + dark themes)
│   │   ├── api.js                  ← API client (auth, intake, pipeline, review, admin, analytics, notifications)
│   │   ├── hooks/
│   │   │   ├── useAuth.jsx         ← Auth context + JWT refresh
│   │   │   ├── useHashRouter.js    ← Client-side hash routing
│   │   │   └── useSSE.js           ← SSE hook for pipeline streaming
│   │   └── components/
│   │       ├── TopBar.jsx          ← Navigation + user menu + admin link
│   │       ├── Welcome.jsx         ← Landing page
│   │       ├── IntakeForm.jsx      ← 21-question form, live scoring, auto-save, progress bar
│   │       ├── CodeUpload.jsx      ← Drag-and-drop upload + pipeline trigger
│   │       ├── Registry.jsx        ← Tool registry with track/status/review filters
│   │       ├── ToolDetail.jsx      ← Tool detail + review panel
│   │       ├── ReviewPanel.jsx     ← Review decisions, notes, track override, self-certify
│   │       ├── Pipeline.jsx        ← Agent progress (SSE streaming, cancel, retry)
│   │       ├── Report.jsx          ← Structured findings report
│   │       ├── NotificationBell.jsx ← In-app notifications dropdown
│   │       ├── AdminDashboard.jsx  ← Tabbed admin (overview, analytics, users, audit log)
│   │       ├── AgentsPage.jsx      ← Pipeline architecture + model rationale
│   │       ├── FrameworkDoc.jsx    ← 12-section framework reference
│   │       ├── Toast.jsx           ← Toast notifications + confirm dialogs
│   │       ├── Breadcrumb.jsx      ← Breadcrumb navigation
│   │       └── primitives.jsx      ← Shared UI primitives (Btn, Badge, Skeleton, etc.)
└── um-standards/
    ├── SKILL.md                    ← Claude skill for UM AI standards
    └── references/                 ← Role-specific reference docs
```

## Running

### Docker (recommended)

```bash
cp backend/.env.example backend/.env
# Fill in API keys

docker compose up -d
# App at http://localhost:3300/aif
```

### Development

```bash
# Backend
cd backend && npm install && npm run dev

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```

### CLI (pipeline only)

```bash
cd backend
node src/index.js /path/to/codebase           # Default: Track 3
node src/index.js /path/to/codebase TRACK_1   # Register & Go
node src/index.js /path/to/codebase TRACK_4   # Formal Project
```

### API Keys (`backend/.env`)

```bash
OPENAI_API_KEY=sk-...              # Codex CLI
GOOGLE_GENERATIVE_AI_API_KEY=...   # Gemini CLI
OPENROUTER_API_KEY=sk-or-...       # MiniMax + MiMo + Kimi + GLM
ANTHROPIC_API_KEY=sk-ant-...       # Claude (synthesis)
SNYK_TOKEN=...                     # Snyk agent-scan (optional)
JWT_SECRET=...                     # Session signing
DATABASE_URL=postgresql://...      # PostgreSQL
CAS_SERVICE_URL=...                # CAS callback URL
```

## Status

| Component | Status |
|-----------|--------|
| Framework document (v1.5) | Done |
| Scoring model (7 dimensions, weight profiles, track routing) | Done |
| Frontend portal (intake, registry, pipeline, report, framework, agents) | Done |
| Dark mode + WCAG 2.2 AA compliance | Done |
| Backend API (auth, intake, pipeline, registry, review, admin) | Done |
| Agent 1: Code & Security (5-model + Semgrep + npm audit + Snyk + stack deep dive) | Done |
| Agent 2: Accessibility / WCAG 2.2 AA (5-model + eslint-plugin-jsx-a11y) | Done |
| Agent 3: QA / Bug Detection (5-model + ESLint QA) | Done |
| Agent 4: Documentation + HECVAT (3 docs + 87 questions + XLSX) | Done |
| Two-layer architecture (deterministic tools + multi-model convergence) | Done |
| Live CLI output streaming (SSE pass_log events) | Done |
| Docker deployment | Done |
| RBAC (builder/reviewer/admin) | Done |
| Review workflow (approve/reject, self-certify, track override) | Done |
| Admin dashboard (stats, user management, audit log) | Done |
| In-app + email notifications | Done |
| Intake form auto-save & progress recovery | Done |
| Pipeline cancel, retry, per-pass recovery & dead letter queue | Done |
| Security hardening (helmet, CSRF, rate limiting, input validation) | Done |
| Pipeline performance dashboard & model analytics | Done |
| Zod request validation schemas (all state-changing routes) | Done |
| Shell-safe subprocess calls (execFileSync, URL validation, path traversal protection) | Done |
| WCAG 2.2 AA language normalization (was inconsistently "2.1") | Done |
| Test suite (scoring engine + status state machine, 123 tests) | Done |
| MCP connectors (repo, project tracker, docs) | Planned |

---

University of Montana · Office of the CIO · Enterprise IT · 2026
