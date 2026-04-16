# Intake Form

The intake form is a 21-question questionnaire divided into five sections. Answers drive the scoring engine and determine which track a submission enters. The form auto-saves continuously; builders can leave and return without losing work.

## Form Behavior

- **Auto-save.** Local storage receives a snapshot every five seconds while typing. The server receives a draft every 60 seconds provided the tool has a name. A status indicator in the right sidebar shows `Unsaved changes`, `Saving...`, or `Saved HH:MM AM/PM`.
- **Recovery.** If the browser tab closes with unsaved work, the form prompts for recovery on next load. Local recovery data expires after seven days.
- **Live scoring sidebar.** The right rail shows the current track assignment, weighted percentage, escalation flags, and per-dimension scores. This is a preview; the backend recomputes scores authoritatively on submit.
- **Progress bar.** Shows answered questions out of the visible total. Visible count depends on conditional sections.
- **Validation.** Required fields are flagged with a red `REQUIRED` marker. Submit fails if any required field is blank; the form scrolls to and focuses the first invalid field.

## Conditional Sections

Two sections appear only when relevant:

| Section | Visibility Trigger |
|---------|---------------------|
| Data (Q10-Q13) | Q9 answered `Yes — handles data`. |
| AI-specific (Q19-Q21) | Q1 is `ai-agent`, or Q12 is any "Yes" answer indicating external AI processing. |

## Section 0: Tool Identity

| Field | Purpose |
|-------|---------|
| Tool name | Short, descriptive name. Required. |
| Description | Free text. Optional but recommended. |

## Section 1: What Did You Build?

Four questions that establish artifact type and audience.

| # | Question | Routing Effect |
|---|----------|----------------|
| Q1 | What best describes what you built? | Selects the weight profile. Options: public-site, internal-app, script-api, ai-agent, data-pipeline, other. |
| Q2 | Is this tool already in production? | Context only — does not affect score. |
| Q3 | Who will use this tool? (multi-select) | Drives Blast Radius. Public or external users score highest. |
| Q4 | Describe what this tool does. | Free text, 3-5 sentences. |

## Section 2: Deployment and Access

| # | Question | Routing Effect |
|---|----------|----------------|
| Q5 | Where will this tool be accessible? | Drives Security. Public-no-auth = 3, public-with-auth = 2, campus/VPN = 1, internal server = 0. |
| Q6 | Does this tool use campus SSO? | `custom-auth` adds +1 to Security and triggers an escalation. |
| Q7 | What infrastructure does this tool require? (multi-select) | Informs reviewer context. |
| Q8 | Expected number of users? | `500+` adds +1 to Blast Radius. |

## Section 3: Data

Shown only if Q9 is `Yes`.

| # | Question | Routing Effect |
|---|----------|----------------|
| Q9 | Does this tool handle any data? | `No` forces Data Sensitivity to 0. |
| Q10 | What kind of data? (multi-select) | HIPAA, IRB, export-controlled, or tribal data = 3 and escalation. FERPA, HR, payment, credentials, behavioral = 2. Internal = 1. |
| Q11 | Where does the data live? (multi-select) | `Personal accounts` triggers an escalation. |
| Q12 | Does data leave campus for AI processing? | `No DPA` or `DPA unknown` triggers an escalation. |
| Q13 | AI model provider and model? | Free text. Informs model drift risk. |

## Section 4: Maintenance and Ownership

| # | Question | Routing Effect |
|---|----------|----------------|
| Q14 | Who owns this tool? | Context for reviewer. |
| Q15 | Is the code in version control? | `No version control` adds to Maintenance and triggers an escalation. |
| Q16 | If you left the institution, what happens? | `nobody` or `would stop being maintained` adds to Maintenance. |
| Q17 | Expected maintenance model? | `third-party-dep` adds to Maintenance. |
| Q18 | If this tool breaks, who fixes it? | `only-me` or `unknown` adds to Maintenance. |

## Section 5: AI-Specific Questions

Shown only when Q1 = `ai-agent` or Q12 indicates external AI processing.

| # | Question | Routing Effect |
|---|----------|----------------|
| Q19 | Explain in plain language what the tool does and its failure modes. | Comprehension dimension: length < 20 chars = 3, < 80 = 2, < 200 = 1, >= 200 = 0. |
| Q20 | What decisions does the tool make? Is there human oversight? | Long answers (> 10 chars) add +1 to Autonomy. |
| Q21 | Will users know they are interacting with AI? | `no` adds +2 to Autonomy. `partial` adds +1. `no` combined with student users triggers an escalation. |

## Sandbox Mode

At the bottom of the form, a sandbox checkbox toggles private-submission mode. Sandboxed tools:

- Run the full pipeline and generate reports normally.
- Are visible only to the owner and admins.
- Cannot be activated until sandbox mode is disabled.

Use sandbox mode for testing the framework or running the pipeline against work that is not ready for institutional registration.

## Draft Management

- **Save Draft** button (secondary action) — manually writes the current state to the server. Requires a tool name.
- **Submit Intake & Upload Code** (primary action) — finalizes the draft, computes the authoritative score, creates the tool record, and navigates to the code upload step.
- Drafts remain editable from the registry. Each draft has a unique URL at `#/intake-edit/<id>`.

## After Submission

On submit, the portal:

1. Validates required fields.
2. POSTs the answers to the backend, which recomputes scores from scratch using the authoritative [scoring engine](../framework/scoring-model.md).
3. Creates a `tools` record with the assigned track.
4. Redirects to the code upload page (`/upload/<toolId>`).

Once code is uploaded (Git URL or ZIP), the pipeline is queued. Watch its progress on the [Pipeline](pipeline.md) page.

## Accessibility

The form follows WCAG 2.2 AA:

- Radio and checkbox options use `role="radio"` and `role="checkbox"` with explicit `aria-checked` states.
- Question groups carry `role="radiogroup"` or `role="group"` with `aria-labelledby`.
- Validation errors attach via `aria-describedby` and `aria-invalid`.
- The save status indicator uses `aria-live="polite"` so screen readers announce save transitions.
- The progress bar has `role="progressbar"` with `aria-valuenow`.

## Related Reading

- [Scoring Model](scoring-model.md) — how answers translate to dimension scores.
- [Tracks](tracks.md) — what happens after scoring.
- [Framework Reference: Escalation Conditions](../framework/escalation-conditions.md) — the seven override conditions in detail.
