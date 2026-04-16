# Frequently Asked Questions

Common questions about AIF from both builders and reviewers. For deeper reference, see the [Framework](../framework/) and [API](../api/) sections.

## General

### What is AIF?

AIF is a governance portal for AI-assisted tools. Builders submit tools through an intake form, the system scores them across seven dimensions, routes them to one of four tracks, and runs a five-model automated pipeline that produces findings and documentation. See [Overview](overview.md).

### Who should submit tools through AIF?

Anyone at the institution who built a tool with AI assistance and wants to use it beyond their own laptop. That includes faculty, staff, students, and contractors. If the tool will be shared with another user, deployed to a server, or relied on for institutional work, it belongs in AIF.

### Is AIF only for AI-built tools?

The framework was designed for AI-assisted code because that is the fastest-growing class of shadow IT in higher education. The pipeline and scoring logic work equally well on non-AI code. In practice, institutions adopt AIF as their general review portal for custom tools.

### Do I need to be a programmer to submit?

Basic familiarity with code is helpful. The intake form's Section 5 asks for a plain-language explanation of what the tool does; a builder who cannot answer that question is likely not ready to submit. However, the intake does not require deep technical language — it asks what the tool does, who uses it, and how it is maintained.

## Scoring and Tracks

### My tool scored higher than I expected. Why?

Most surprises come from:

- **Blast Radius** — selecting `students` or `public` in Q3 elevates this substantially.
- **Autonomy** — Q21 = `no` adds +2. If users will not be told they are interacting with AI, the score jumps.
- **Maintenance** — several low-severity signals compound (no version control + no succession plan + only-me responder).
- **Escalations** — any single escalation condition forces Track 4 regardless of the weighted percentage.

The live scoring sidebar shows which dimensions are driving your score in real time as you answer.

### Can I appeal a track assignment?

Yes. Two paths:

1. **Reviewer override.** Contact your reviewer and request a track change with justification. Reviewers and admins can override either direction via the review panel.
2. **Re-answer the intake.** If the track was based on answers that no longer reflect the tool (e.g., you have since added SSO), edit the draft or submit a new intake.

### What if an escalation condition applies but the tool is clearly low-risk?

Escalations are absolute by design. The override mechanism in [Review Decisions](review-decisions.md) exists for cases where an escalation fired on a technicality. Contact your reviewer with a clear explanation of why the condition does not apply in practice.

### Are all tracks run through the same pipeline?

Yes. The pipeline is uniform across all four tracks. Track determines governance (who has to approve before activation), not analysis depth. A Track 1 tool receives the same five-model code review as a Track 4 tool.

## The Pipeline

### How long does the pipeline take?

Typical total runtime is 15-30 minutes. Breakdown:

- Pass 1 (Codex, full filesystem access): 7-10 minutes usually.
- Passes 2-5 (direct API, bundled codebase): 1-3 minutes each, run in parallel.
- Synthesis (Claude): 2-5 minutes per agent.
- Agent 4 (documentation): 3-8 minutes for document generation plus HECVAT.

Larger codebases take longer. The elapsed timer on the pipeline page shows live duration.

### Can I leave while the pipeline runs?

Yes. The pipeline runs server-side. Closing the browser does not cancel it. On return, the pipeline page reconnects to the live event stream.

### Can I cancel a run?

Yes. The **Cancel pipeline** button on the pipeline page terminates all active child processes. Cancellation is clean — no billing for unstarted passes — and the run status moves to `cancelled`. See [Pipeline](pipeline.md#cancelling-a-run).

### What if a pass fails?

Each pass retries once with backoff. If both attempts fail, the agent proceeds with partial results as long as at least 4 of 5 passes succeeded. The agent output is flagged `partial: true` and the event stream records the failure.

If the whole run fails, the page offers a **Retry run** button for up to 2 retries. After that, the run goes to the dead letter queue.

### Why do I see different findings on re-run?

Model outputs are non-deterministic. Running the pipeline twice on the same codebase produces similar but not identical findings. The three-pass confirmation threshold (a finding is confirmed if 3 of 5 passes report it) is intended to reduce this noise. Finding statuses (resolved, wontfix, false_positive) persist across runs for the same tool, so triage work is not lost.

## Code Submission

### How do I upload code?

Two methods, selected on the upload page after submitting the intake:

1. **Git URL** — HTTPS URLs to GitHub, GitLab, or other repositories. The system clones the repo. Only HTTPS is accepted; SSH URLs are rejected.
2. **ZIP archive** — Drag and drop or file picker. The archive is extracted with path-traversal protection.

### Does AIF store my code after the run?

Yes, in a sandboxed directory used by the pipeline. Source code extracts are retained for the life of the pipeline run and accessible only to admins. Raw code is not visible in the UI; only the findings and generated documents are. The data retention job prunes older artifacts according to institutional policy.

### Can I run AIF against a private repository?

Yes, if the Git URL is HTTPS and credentials are embedded (e.g., a personal access token in the URL). Alternatively, upload a ZIP. Note: URLs with embedded credentials are not logged but do end up in the pipeline run's internal state. Prefer ZIP for sensitive code.

### What languages are supported?

The pipeline is language-agnostic. Pass 1 (Codex with filesystem access) explores whatever is present. Passes 2-5 receive a pre-bundled slice of the codebase (source files under a 400K character budget, large non-source files excluded). Common languages supported with good signal: JavaScript, TypeScript, Python, Go, Rust, Ruby, Java, PHP. Less common: well, it still runs, but the findings may be sparser.

## Reviewers

### How do I get added as a reviewer?

Contact an admin. Role changes are made through the [Admin Dashboard](../admin-guide/user-management.md). Reviewers see all non-sandboxed tools in the registry and can approve or request changes on any tool in `under_review`.

### What should I look for when reviewing a Track 3 submission?

Start with the findings review page. Priorities:

1. Critical and high findings. Must be resolved or explicitly marked `wontfix` with rationale.
2. Escalation conditions. If any fired, verify they are legitimate; consider track override if not.
3. Dimension scores. Low Comprehension signals risk — does the plain-language explanation match reality?
4. Generated documents. The `USER_GUIDE.md` and `ADMIN_GUIDE.md` produced by Agent 4 should match what the builder described.
5. Comment thread. Has the builder clarified open questions?

See [Review Decisions: Writing Good Decision Notes](review-decisions.md#writing-good-decision-notes).

### Can a reviewer approve their own tool?

Technically yes — the authorization check does not prevent it. Institutionally, this is discouraged. The audit log records the reviewer netid, and admins inspecting the log will see self-reviews clearly.

### Can I re-review a tool already in `active`?

Yes. The status state machine allows `active -> under_review` for reviewers and admins. Use this for periodic audit or when new information emerges.

## Notifications

### I am not getting emails.

Three possible causes:

1. Email delivery is off in preferences. Open the bell -> Settings and check the **Email notifications** checkbox.
2. No email address on file. Add one in Settings.
3. SMTP is not configured at the portal level. Contact an admin.

See [Notifications: Troubleshooting](notifications.md#troubleshooting).

### How do I stop getting notifications for a specific tool?

There is no per-tool mute. Options:

- Turn off in-app or email globally.
- If you are the reviewer broadcast recipient, ask an admin to reassign.

Role-based broadcasts (`review_needed`, `tool_activated` for self-certified Track 2) go to every active reviewer or admin respectively. Individual opt-out is not currently supported.

## Admin and Data

### How long is data retained?

- `pass_results` rows older than 90 days are archived.
- Read notifications older than 30 days are pruned.
- `audit_log` is retained indefinitely (admins may prune on policy).

See [Admin Guide: Data Retention](../admin-guide/data-retention.md).

### Who can see my tool's findings?

| Role | Visibility |
|------|-----------|
| Builder | Their own tools + any `active` or `approved` non-sandboxed tool. |
| Reviewer | All non-sandboxed tools. |
| Admin | Everything including sandboxed tools. |

Sandbox mode restricts a tool to owner-and-admin visibility.

### Can I delete my tool?

Yes. Owners and admins can delete a tool from the tool detail page. Deletion cascades to pipeline runs, findings, notifications, and review notes. The audit log entry for the deletion is retained.

## Technical

### Why does the pipeline use five different models?

Convergence. Each of the five models (Codex, MiniMax, MiMo, Kimi, GLM) independently reviews the same codebase. Findings confirmed by 3 or more passes are higher-confidence than findings from a single model. This reduces both false positives (a quirk of one model) and false negatives (a blind spot of one model). Claude synthesizes the five outputs and arbitrates disagreements.

### What happens if OpenAI or OpenRouter is down?

The affected passes fail and retry once. If both attempts fail and the agent has at least 4 of 5 passes, it proceeds with partial results. If fewer than 4 pass, the agent fails. The run itself may still complete if other agents succeed, or the builder can retry once the provider recovers.

### Can I run AIF on my own infrastructure?

Yes. The portal is designed for portability. See [Institutional Adoption](../institutional-adoption/overview.md). Configuration is centralized in `src/config.js`; institution name, domain, auth mode, and SMTP settings are environment-driven.

## Still Stuck?

- Review the other user-guide pages linked throughout this document.
- Check the [Framework Reference](../framework/) for policy-level questions.
- Check the [API reference](../api/) for programmatic access.
- Contact your admin (portal operator) or IT security reviewer for institutional questions.
