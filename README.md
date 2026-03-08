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
│  Blast Radius (0-3)      ─┤─→ Weighted % ─→ Track 1-4           │
│  Autonomy (0-3)          ─┤   (by artifact type)                 │
│  Comprehension (0-3)     ─┤   + escalation override              │
│  Maintenance (0-3)       ─┘                                      │
│                                                                  │
│  <22% → Track 1    22-42% → Track 2    42-65% → Track 3         │
│  Register & Go     Self-Certify        IT Review                 │
│                                                 ≥65% → Track 4  │
│                                                 Formal Project   │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                      AGENT PIPELINE                              │
│                                                                  │
│  All tracks run the same pipeline — uniform 5-model analysis     │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │ Agent 1  │  │ Agent 2  │  │ Agent 3  │  │ Agent 4  │         │
│  │ Code &   │  │ Access-  │  │ HECVAT   │  │  Docs    │         │
│  │ Security │  │ ibility  │  │ 4 Lite   │  │Generation│         │
│  │          │  │          │  │          │  │          │         │
│  │ 5 models │  │ 5 models │  │ 1 Claude │  │ 1 Claude │         │
│  │+synthesis│  │+synthesis│  │  pass    │  │  pass    │         │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘         │
│       │             │             │              │               │
│       └──────┬──────┘      reads 1+2      reads 1-3             │
│              │                                                   │
│              ▼                                                   │
│  ┌────────────────────────────────────────────────────────┐      │
│  │  Claude Synthesis + Dispute Resolution                 │      │
│  │  3+ models agree → confirmed                          │      │
│  │  1-2 models → potential                               │      │
│  │  0 models → clean                                     │      │
│  └────────────────────────────────────────────────────────┘      │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                         OUTPUT                                   │
│  Security findings · A11y audit · HECVAT XLSX                    │
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

### Agent 1: Code & Security Analysis

Multi-model (5 passes + Claude synthesis). 10-section rubric: technology inventory, external services, data operations, authentication, secrets, AI/ML usage, MCP/agent security, escalation checks, 7-dimension scoring signals, prioritized findings.

**Integrated tools:** Snyk Agent Scan (MCP config / SKILL.md security).

### Agent 2: Accessibility Audit

Multi-model (5 passes + Claude synthesis). WCAG 2.2 Level AA audit: ARIA, keyboard navigation, color contrast, semantic structure, forms, images, dynamic content, modals, responsive design.

### Agent 3: HECVAT 4 Lite Self-Assessment

Single Claude pass (reads Agent 1+2 output). Pre-populates 87 Critical Importance questions from HECVAT 4.15 across 23 categories. ~60% answerable from code; remainder flagged for human input. Exports to official HECVAT XLSX template.

### Agent 4: Documentation Generation

Single Claude pass (reads Agent 1-3 output). Generates three documents: User Guide, Admin Guide, Compliance Summary. Output as Markdown and .docx (via Pandoc). User Guide and Admin Guide auto-published to Notion knowledge base.

### Multi-Model Convergence

Five different AI models receive the **same prompt** and independently analyze the entire codebase:

| Pass | Model | CLI Tool | Why |
|------|-------|----------|-----|
| 1 | GPT-5.4 | Codex CLI | Structured reasoning, logical vulnerability detection |
| 2 | Gemini 2.5 Pro | Gemini CLI | 1M token context, cross-file dependency analysis |
| 3 | Grok 3 Fast | opencode | Fastest pass (~30s), different training data |
| 4 | Kimi K2 | opencode | 1T MoE architecture, edge case detection |
| 5 | Qwen3 Coder | QwenCode | Code-specialized tokenization, supply chain focus |
| Synth | Claude Opus 4.6 | Claude Code | Synthesis only — dispute resolution with filesystem access |

No model reviews its own work. Claude only synthesizes — it never runs a pass. The codebase is extracted into an isolated Docker container for security.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite, CSS design system, dark mode |
| Backend | Node.js (ESM), Express, PostgreSQL |
| Auth | CAS via login.umt.edu, JWT cookies |
| AI Models | 5 models via CLI tools + Claude synthesis |
| APIs | OpenAI, Google, xAI direct; Kimi + Qwen via OpenRouter |
| Infrastructure | Docker (multi-stage build + docker-compose) |

## Project Structure

```
AIF/
├── CLAUDE.md                       ← Claude Code project instructions
├── ARCHITECTURE.md                 ← Full architecture spec
├── um-ai-built-tool-intake.docx    ← Framework policy document (v1.0)
├── Dockerfile                      ← Multi-stage build (frontend + backend)
├── docker-compose.yml              ← App + PostgreSQL
├── backend/
│   ├── src/
│   │   ├── index.js                ← CLI entry point
│   │   ├── server.js               ← Express HTTP API
│   │   ├── scoring.js              ← Shared scoring module (7 dimensions, weights, tracks)
│   │   ├── orchestrator/index.js   ← Pipeline orchestration (4 agents, uniform 5-model)
│   │   ├── pipeline/
│   │   │   ├── queue.js            ← Job queue with SSE progress streaming
│   │   │   └── events.js           ← SSE event emitter
│   │   ├── agents/
│   │   │   ├── shared/cli.js       ← CLI execution, JSON extraction, env loading
│   │   │   ├── code-analysis/      ← Agent 1 (prompts + runner)
│   │   │   ├── accessibility/      ← Agent 2 (prompts + runner)
│   │   │   ├── hecvat/             ← Agent 3 (prompts + runner + XLSX export)
│   │   │   └── documentation/      ← Agent 4 (prompts + runner)
│   │   ├── routes/                 ← API routes (auth, intake, pipeline, registry, reports)
│   │   ├── auth/                   ← CAS auth, JWT, middleware
│   │   └── db/                     ← PostgreSQL pool + migrations
│   └── migrations/                 ← SQL schema
├── frontend/
│   ├── src/
│   │   ├── App.jsx                 ← Root shell, routing
│   │   ├── constants.js            ← Scoring engine, color palette, metadata
│   │   ├── styles.css              ← CSS design system (light + dark themes)
│   │   ├── api.js                  ← API client
│   │   ├── components/
│   │   │   ├── TopBar.jsx          ← Navigation + user menu
│   │   │   ├── Welcome.jsx         ← Landing page
│   │   │   ├── IntakeForm.jsx      ← 21-question form with live scoring
│   │   │   ├── CodeUpload.jsx      ← File upload + pipeline trigger
│   │   │   ├── Registry.jsx        ← Tool registry with filters
│   │   │   ├── Pipeline.jsx        ← Agent progress (SSE streaming)
│   │   │   ├── Report.jsx          ← Findings report
│   │   │   ├── ToolDetail.jsx      ← Tool detail page
│   │   │   ├── FrameworkDoc.jsx    ← 12-section framework reference
│   │   │   └── AgentsPage.jsx      ← Pipeline architecture + model rationale
│   │   └── hooks/                  ← useAuth, useHashRouter, useSSE
│   └── vite.config.js
├── um-standards/
│   ├── SKILL.md                    ← Claude skill for UM AI standards
│   └── references/                 ← Role-specific reference docs
└── hecvat415.xlsx                  ← HECVAT 4.15 template
```

## Running

### Docker (recommended)

```bash
cp backend/.env.example backend/.env
# Fill in API keys

docker compose up -d
# App at http://localhost:3000/aif
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
OPENROUTER_API_KEY=sk-or-...       # Grok + Kimi + Qwen
ANTHROPIC_API_KEY=sk-ant-...       # Claude (synthesis)
SNYK_TOKEN=...                     # Snyk agent-scan (optional)
JWT_SECRET=...                     # Session signing
DATABASE_URL=postgresql://...      # PostgreSQL
CAS_SERVICE_URL=...                # CAS callback URL
```

## Status

| Component | Status |
|-----------|--------|
| Framework document (v1.0) | Done |
| Scoring model (7 dimensions, weight profiles, track routing) | Done |
| Frontend portal (intake, registry, pipeline, report, framework, agents) | Done |
| Dark mode | Done |
| Backend API (auth, intake, pipeline, registry) | Done |
| Agent 1: Code & Security (5-model + Snyk) | Done |
| Agent 2: Accessibility / WCAG 2.2 AA (5-model) | Done |
| Agent 3: HECVAT 4 Lite (87 questions + XLSX export) | Done |
| Agent 4: Documentation (3 docs + Pandoc + Notion) | Done |
| Docker deployment | Done |
| Admin/reviewer views | Planned |
| MCP connectors (repo, project tracker, docs) | Planned |

---

University of Montana · Office of the CIO · Enterprise IT · 2026
