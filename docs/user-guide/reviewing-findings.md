# Reviewing Findings

The findings review page is where builders and reviewers triage what the pipeline produced. Each finding carries a severity, a category, an optional file location, and a status. This page is the main decision surface between a completed pipeline run and a state change (self-certify, submit for review, or approve).

## Accessing the Page

The findings page lives at:

```text
#/review/<toolId>
#/review/<toolId>/<runId>
```

Navigate via:

- **Open report** button on the pipeline page after completion.
- **Findings** link on the tool detail page.
- Registry row -> tool detail -> Findings tab.

If a tool has multiple completed runs, a dropdown in the page header lets the user switch between them. The latest completed run loads by default.

## Page Anatomy

### Status Bar

Top row shows:

- Tool name and current track badge.
- Run selector (if multiple completed runs exist).
- Open/resolved counts.
- **Re-scan** button — re-uploads code to trigger a new pipeline run.

### Severity Summary

A row of five cards showing counts by severity: Critical, High, Warning, Medium, Info. Empty severities display in a muted color.

### View Modes

Three tabs select the display mode:

| Mode | What It Shows |
|------|---------------|
| Summary | Per-category cards with stacked severity bar, plus a remediation progress meter. |
| Findings | Flat, filterable list of every finding. |
| File Tree | Two-pane layout: project tree on the left, findings for the selected file on the right. |

### Filters

In Findings mode, two dropdowns filter the visible list:

- **Severity** — critical, high, warning, medium, low, info, or all.
- **Category** — Code & Security, Accessibility, QA, Documentation, or all.

Findings are always sorted by severity order (critical first).

## Finding States

Every finding has a `status` that the user can change:

| Status | Meaning | When to Use |
|--------|---------|-------------|
| `open` | Not yet addressed. | Default for all new findings. |
| `resolved` | Code change made that fixes the finding. | After remediation. |
| `wontfix` | Intentional; will not be fixed. | Documented exception with reasoning. |
| `false_positive` | The finding is incorrect. | Agent surfaced something that is not actually a problem. |

Status changes persist per-tool (not per-run). Changing status on a finding carries forward if the user re-runs the pipeline and the same finding reappears.

### Saving Status Changes

Status updates are debounced and batched: changes are held for 500 ms, then sent to the server as a single update. If the user clicks through several findings rapidly, only one network call fires.

If the save fails, the change reverts on the next page load but remains in the local UI state. A toast notification signals failures.

## Triage Workflow

A typical triage session:

1. Open the page. Note total finding counts by severity.
2. Switch to Findings mode. Filter to `Critical` severity.
3. For each critical finding:
   - Read the description and the file/line location.
   - Decide: is this real? If no, mark `false_positive` and move on.
   - If real and fixable now, address it in the code; mark `resolved`.
   - If real but intentional, mark `wontfix` and add a comment explaining the decision.
4. Repeat for `High`, then `Warning`.
5. Warning and below are judgment calls. Summary findings and info items rarely block activation.

## Exporting Findings

The page has two export buttons in the action bar:

- **Export CSV** — All findings, flat tabular format. Useful for spreadsheet triage.
- **Export JSON** — Full finding records with all metadata. Useful for scripting.

Both exports are scoped to the current run. Both are generated on the fly via `GET /reports/:runId/findings.csv` and `.json`.

## Remediation Progress

The Summary view includes a remediation progress bar aggregating all statuses:

- Green — `resolved`.
- Purple — `false_positive`.
- Gray — `wontfix`.
- Red (remainder) — `open`.

The progress bar is a quick visual indicator of triage completion. A reviewer looking at a Track 3 submission expects to see critical and high findings either resolved or documented as won't-fix with clear rationale before approving.

## Action Buttons

At the bottom of the page, the primary CTA depends on track and current status:

| Track | Status | Primary Button |
|-------|--------|----------------|
| 1 or 2 | Not yet acknowledged | **Acknowledge Findings & Register** -> transitions to `active`. |
| 3 or 4 | Not yet submitted | **Submit for IT Review** -> transitions to `under_review`. |
| Any | Already submitted | Status banner showing current state; no primary action. |

Secondary buttons: **View Full Report**, **Export CSV**, **Export JSON**.

## After Submission

Once submitted for IT review, the page shows an acknowledgment card summarizing:

- Tool name and track.
- Count of critical/high versus warning/medium findings.
- Next steps: reviewer assignment, possible clarification requests, approval requirement.
- Links back to the tool detail page and registry.

At this point, builder action shifts to the comment thread on the tool detail page. Reviewers continue the conversation via [Review Decisions](review-decisions.md).

## Findings Categories

The findings UI maps pipeline agent output to four display categories. A finding's category is determined by which agent reported it:

| Category | Agent | Typical Contents |
|----------|-------|-------------------|
| Code & Security | Agent 1 | Secrets, auth issues, OWASP findings, dependency vulnerabilities, insecure patterns. |
| Accessibility | Agent 2 | WCAG violations: ARIA, keyboard traps, color contrast, missing alt text. |
| QA / Bugs | Agent 3 | Logic bugs, race conditions, null dereferences, unhandled exceptions, state management issues. |
| Documentation | Agent 4 | Missing inline docs, inconsistencies between code and generated guides. |

## Severity Conventions

Severity is assigned per-finding by the agent, normalized across agents:

| Severity | Meaning |
|----------|---------|
| `critical` | Must be fixed. Blocks approval. |
| `high` | Strongly recommended. Typically blocks approval. |
| `warning` | Should be addressed. Reviewer discretion. |
| `medium` | Quality issue. Not a blocker. |
| `low` | Minor. Usually cosmetic. |
| `info` | Informational only. |

Reviewers have discretion on warning and below. Critical and high should either be fixed or explicitly marked `wontfix` with rationale before approval.

## Accessibility

- Finding cards are focusable and keyboard-operable.
- Status dropdowns use native `<select>` elements.
- Filter controls have `aria-label` attributes describing their purpose.
- The file tree uses `role="tree"` with keyboard navigation.
- Severity cards display their count using `font-weight: 700` and severity-colored text.

## Related Reading

- [Review Decisions](review-decisions.md) — reviewer actions after the builder submits.
- [Pipeline](pipeline.md) — where findings come from.
- [Scoring Model](scoring-model.md) — how findings relate to dimension scores.
- [API: Reports](../api/reports.md) — programmatic access to findings.
