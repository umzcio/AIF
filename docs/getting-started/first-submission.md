# First Submission

## Summary

This walkthrough takes a freshly installed AIF portal through a complete tool submission: logging in, completing the 21-question intake form, uploading a codebase, watching the five-model pipeline stream progress, reviewing findings, and retrieving the generated HECVAT XLSX. The walkthrough assumes `AUTH_PROVIDER=bypass` (auto-login as an admin) but the flow is identical for every provider once authentication succeeds.

Allow 15–25 minutes for the full pipeline to complete, depending on codebase size and model latency.

## Prerequisites

- [ ] Portal running and healthy (see [installation.md](installation.md))
- [ ] All three pipeline API keys populated (`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`)
- [ ] A small test codebase ready to upload — either a `.zip`, `.tar.gz`, or a public HTTPS git URL
- [ ] Browser pointed at `http://localhost:3300/aif/` (or your configured `FRONTEND_URL`)

For the first pass, use a small codebase (under 400k characters of source). The Node.js sample at `https://github.com/expressjs/express` or any small internal utility works well.

## Step 1 — Log in

Open the portal in your browser:

```
http://localhost:3300/aif/
```

Behavior by provider:

- **`bypass`** — you are already authenticated as `Dev User` (`netid=dev`, `role=admin`). No login page.
- **`cas`, `header`, `oidc`, `saml`** — click **Sign in** in the top-right corner. You are redirected to your identity provider and returned to the portal on success.

Confirm the session is active by clicking the user menu in the top-right. You should see your display name and role. Admins see an **Admin** entry in the top-bar navigation; builders and reviewers do not.

## Step 2 — Open the intake form

From the landing page, click **Submit New Tool**. This opens the intake form at `#/intake`.

The intake form is a single page with three regions:

- **Left**: the 21 questions, grouped into sections (Tool Basics, Data, Users, AI Usage, Authentication, Governance).
- **Right**: a live scoring sidebar showing the seven dimension scores, the weighted percentage, and the recommended Track as you answer.
- **Top**: a progress bar and a Save Indicator that reflects auto-save state.

The sidebar is preview-only. The backend recomputes the authoritative score from the raw answers on submit; see [../user-guide/intake-form.md](../user-guide/intake-form.md) for the full question-by-question reference.

## Step 3 — Answer the 21 questions

Answer all 21 questions. Categories cover:

1. **Tool Basics** — name, description, artifact type (public site, internal app, script/API, AI agent, data pipeline, other)
2. **Data** — data sensitivity (none, internal, PII, FERPA/HIPAA/export-controlled), storage, retention
3. **Users** — audience, blast radius (builder-only, team, department, institution-wide)
4. **AI Usage** — AI model provider, DPA status, user awareness of AI interaction
5. **Authentication** — SSO vs. personal accounts vs. custom auth
6. **Governance** — version control, maintenance plan, test coverage, builder comprehension

Changes auto-save to `localStorage` with a five-second debounce and to the server draft table every sixty seconds. If the browser closes before submission, a recovery prompt appears on return.

Field validation flags missing required answers in red with inline hints. Focus jumps to the first invalid field on submit attempt.

Once the sidebar shows a Track recommendation, review the weighted percentage and the escalation indicators. Seven escalation conditions can force Track 4 regardless of score (see [../framework/escalations.md](../framework/escalations.md)).

Click **Submit**. The intake form posts to `POST /aif/api/intake`, which recomputes the authoritative score server-side and creates a record in the `tools` table with status `pending`.

## Step 4 — Upload the codebase

After submission the portal navigates to the tool detail page at `#/tool/<uuid>`. Click **Start Pipeline**. The code upload component offers two options:

**Option A — Archive upload.** Drag a `.zip`, `.tar.gz`, or `.tgz` file onto the drop zone, or click to browse. The backend extracts the archive to `/data/codebases/<run-id>/` with path-traversal protection (`validateExtractedPaths()`) and enforces a size ceiling.

**Option B — Git clone.** Paste a public HTTPS git URL (for example `https://github.com/your-org/your-repo.git`). The URL is validated against HTTPS-only and shell-metacharacter rules (`validateUrl()`) before `git clone` runs with `execFileSync`. An optional `GIT_ALLOWED_HOSTS` env var restricts targets.

After the codebase is staged, the portal creates a pipeline run (`POST /aif/api/pipeline/run`) and navigates to the live pipeline view.

## Step 5 — Watch the pipeline stream

The Pipeline view opens an SSE stream at `GET /aif/api/pipeline/<run-id>/stream` and renders each event as it arrives. You will see four sequential agents, each with a progress strip showing its constituent passes:

| Agent | Passes | Typical duration |
|-------|--------|------------------|
| 1: Code & Security | 5 model passes + Claude synthesis + Semgrep/npm-audit/Snyk | 8–15 min |
| 2: Accessibility | 5 model passes + Claude synthesis + jsx-a11y lint | 6–12 min |
| 3: QA / Bug Detection | 5 model passes + Claude synthesis + ESLint QA | 6–12 min |
| 4: Documentation + HECVAT | 3 parallel Claude/Gemini/GLM passes + Pandoc conversion | 2–4 min |

Within each agent, individual model passes move through the states `queued → running → parsing → done`, with timing and output size shown on completion. Failed passes enter a one-attempt retry with backoff; a dead-letter state marks the pass as permanently failed after two total attempts.

Available controls during a run:

- **Cancel** — issues `POST /aif/api/pipeline/<run-id>/cancel`. An `AbortController` propagates SIGTERM to all child processes, with a SIGKILL fallback after 10 seconds.
- **Retry** — available only after a terminal failure. Creates a new run linked via `parent_run_id`.

The stream also surfaces pass metrics (timing, parse status, output size, error category) that are persisted to `pass_results` for the admin analytics dashboard.

If 4 of 5 model passes succeed on a given agent, synthesis continues with partial results; all 5 failing escalates the agent to failed status and blocks the next agent.

## Step 6 — Read the findings report

When all four agents complete, the portal navigates to the Report view automatically (or click **View Report**). The report has three sections:

**Top panel — Scoring.** The seven dimension scores, the weighted percentage, the assigned Track, and any triggered escalation conditions. This is the authoritative scoring output, recomputed from the intake answers plus any agent-driven recommendations.

**Agent tabs.** One tab per agent. Each tab lists findings with:

- **Severity** — critical, high, medium, low, info (with WCAG-AA compliant color coding)
- **Confidence tier** — `Tool-Verified` (Semgrep, ESLint, npm audit), `Confirmed` (3+ of 5 models agreed), or `Potential` (1–2 models flagged)
- **File:line evidence** — click to expand the source excerpt
- **Triage state** — mark open / resolved / won't fix; saved with debounced persistence

**File tree view.** Findings grouped by source file rather than by agent. Useful for builders working through a single file at a time.

Track-specific next steps are surfaced at the top of the report:

- **Track 1** — auto-activates on pipeline completion; the tool moves directly to `active` status. Track 1 auto-activation is gated: intake-vs-code contradictions, confirmed critical findings, partial analysis, or truncated bundle coverage route the tool to human review instead (see the activation gate in the Framework Reference).
- **Track 2** — a Self-Certify button appears for the tool owner. Clicking it transitions status to `approved`, pending builder sign-off in the attestation dialog.
- **Track 3 / Track 4** — the tool sits in `under_review` until a reviewer or admin clicks Approve or Request Changes in the Review Panel.

## Step 7 — Retrieve the HECVAT XLSX

Switch to the **Documentation** tab. Four artifacts are available for download:

| Artifact | Filename | Format |
|----------|----------|--------|
| User Guide | `USER_GUIDE.docx` | Word document (via Pandoc) |
| Admin Guide | `ADMIN_GUIDE.docx` | Word document |
| Compliance Summary | `COMPLIANCE_SUMMARY.docx` | Word document |
| HECVAT 4.15 self-assessment | `hecvat_assessment.xlsx` | Official EDUCAUSE XLSX template |

The HECVAT file is the official EDUCAUSE 4.15 Lite template with approximately 65% of the 87 critical questions pre-filled from Agent 1–3 output. Questions that require human judgment (vendor contacts, SOC 2 reports, data center locations) remain blank for the reviewer to complete.

All four artifacts are written to `/data/output/<run-id>/` inside the container, backed by the `aif_output` volume.

## What happens next

- **If the tool is Track 1**, it is already live in the registry. No further action needed.
- **If the tool is Track 2**, the tool owner attests and the tool activates.
- **If the tool is Track 3 or 4**, the tool enters the reviewer queue. A reviewer with `role=reviewer` or `role=admin` opens the tool, reads the report, and either approves, requests changes, or overrides the track (escalate or de-escalate with a documented reason).

Status changes and review decisions are written to `audit_log` with actor, timestamp, and IP. The tool owner receives an in-app notification (and email if `SMTP_HOST` is configured and the user has `notify_email=true`).

## Verifying the run server-side

Inspect database state:

```
docker exec -it aif-db psql -U aif -d aif -c \
  "SELECT id, tool_id, status, created_at, total_duration_s, estimated_cost_usd FROM pipeline_runs ORDER BY created_at DESC LIMIT 1;"
```

Inspect per-pass metrics (the admin analytics tab surfaces this visually):

```
docker exec -it aif-db psql -U aif -d aif -c \
  "SELECT model_name, agent_name, status, duration_ms, output_bytes FROM pass_results WHERE run_id = '<run-id>' ORDER BY created_at;"
```

List output files:

```
docker exec aif-app ls -la /data/output/<run-id>/
```

## Common first-run issues

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Pass 1 times out at 15min | Codex CLI cannot reach `api.openai.com` or `OPENAI_API_KEY` is invalid | Verify the key, re-check container network egress |
| Passes 2-5 all fail with `401` | `OPENROUTER_API_KEY` missing or invalid | Confirm the key in `backend/.env` and restart the container |
| Synthesis fails with `claude: command not found` | Image was built incorrectly | Rebuild: `docker compose build --no-cache app` |
| Pipeline stalls at "queued" | SSE connection dropped by reverse proxy | Ensure the proxy does not buffer `text/event-stream` responses |
| `CSRF token mismatch` on submit | Cookies scoped to a different path | Clear site cookies, reload from `/aif/` |

## See also

- [installation.md](installation.md) — installing the portal
- [configuration.md](configuration.md) — environment variables
- [authentication-setup.md](authentication-setup.md) — SSO providers
- [../user-guide/intake-form.md](../user-guide/intake-form.md) — full 21-question reference
- [../user-guide/review-workflow.md](../user-guide/review-workflow.md) — reviewer actions
- [../admin-guide/](../admin-guide/) — running a portal day-to-day
