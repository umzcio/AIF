# Overview

The AI Production Readiness Framework (AIF) is a risk-tiered governance portal for moving AI-assisted tools from prototype to production. Builders submit tools through a structured intake, the system scores them across seven dimensions, routes them to one of four tracks, and runs an automated five-model agent pipeline that produces a decision-ready report.

## What AIF Does

AIF sits between a working prototype and a production deployment. It answers four questions for every submission:

1. **What is this tool?** — Classification by artifact type and intended audience.
2. **How risky is it?** — A weighted score across security, accessibility, data sensitivity, blast radius, autonomy, comprehension, and maintenance.
3. **What oversight does it need?** — Routing to Track 1 (register and go), Track 2 (self-certify), Track 3 (IT review), or Track 4 (formal project).
4. **What is wrong with the code?** — Structured findings from four agents (code/security, accessibility, QA/bug detection, documentation).

Every submission runs the same pipeline. The track determines what human oversight sits on top of the automated review, not how deep the review goes.

## Who It Is For

AIF has three user roles:

| Role | Who | What They Do |
|------|-----|--------------|
| **Builder** | Anyone submitting an AI-assisted tool. Faculty, staff, students, contractors. | Complete the intake form, upload code, review findings, respond to reviewer comments. |
| **Reviewer** | IT security staff assigned to evaluate Track 3 and Track 4 submissions. | Triage findings, approve or request changes, override tracks when warranted, post review notes. |
| **Admin** | Portal operators. | Manage users, inspect audit logs, view pipeline analytics, configure institutional defaults. |

All three roles can view the portal's public pages (welcome, framework documentation, agents page). Unauthenticated visitors see only active, non-sandboxed tools in the registry.

## Lifecycle of a Submission

```text
draft -> pending -> in_progress -> under_review -> approved -> active
                                        |
                                        v
                                 changes_requested -> pending -> ...
```

Each state has explicit transition rules enforced per role. See [Tracks](tracks.md) and [Review Decisions](review-decisions.md) for the full state machine.

1. **Draft** — Builder fills out the intake form. Answers are auto-saved locally every five seconds and to the server every 60 seconds.
2. **Pending** — Builder submits the intake. Backend recomputes scores authoritatively, assigns a track, and queues the pipeline.
3. **In progress** — The four-agent pipeline runs. The builder can watch progress via the live event stream.
4. **Outcome by track:**
   - Track 1 auto-activates on pipeline completion.
   - Track 2 surfaces findings for the builder to review and self-certify.
   - Track 3 and Track 4 enter `under_review`; a reviewer approves or requests changes.
5. **Under review** — Reviewer reads findings, posts notes, renders a decision.
6. **Approved** — Reviewer or admin activates the tool.
7. **Active** — Tool is registered and visible to builders campus-wide.
8. **Changes requested** — Builder addresses findings, resubmits. Status returns to `pending`.

## Ways to Interact with AIF

| Surface | Purpose |
|---------|---------|
| Intake form | Submit or edit a draft. See [Intake Form](intake-form.md). |
| Registry | Browse tools scoped by role. |
| Tool detail page | View dimension scores, track, run history, reviewer notes. |
| Pipeline page | Live progress of an active pipeline run. See [Pipeline](pipeline.md). |
| Findings review | Triage findings across the four agents. See [Reviewing Findings](reviewing-findings.md). |
| Report | Final structured report per run. |
| Notifications | In-app bell and optional email alerts. See [Notifications](notifications.md). |
| Admin dashboard | Overview stats, analytics, user management, audit log. See the [Admin Guide](../admin-guide/). |

## What the Pipeline Produces

Each completed pipeline run yields:

- A dimension score (7 dimensions, 0-3 each).
- A weighted percentage and track assignment.
- A findings list across four agents with severity, location, and remediation guidance.
- Three generated documents: `USER_GUIDE.md`, `ADMIN_GUIDE.md`, `COMPLIANCE_SUMMARY.md`.
- A HECVAT 4.15 self-assessment with approximately 65% of the 87 critical questions pre-filled.

All findings can be exported as CSV or JSON from the findings review page.

## What AIF Is Not

- Not a replacement for institutional risk governance. It is the automation layer that feeds human decisions.
- Not a code-hosting platform. Submit a Git URL or a ZIP archive of existing code.
- Not a runtime monitor. It reviews code state at submission time; post-production monitoring is out of scope.

## Related Reading

- [Intake Form](intake-form.md) — the 21 questions, section by section.
- [Scoring Model](scoring-model.md) — what each of the seven dimensions measures.
- [Tracks](tracks.md) — what happens in each of Tracks 1-4.
- [Framework Reference](../framework/scoring-model.md) — the authoritative scoring specification.
- [Getting Started](../getting-started/first-submission.md) — step-by-step first submission.
