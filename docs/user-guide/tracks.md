# Tracks

Track assignment determines the governance path for a submission. All four tracks run the same automated pipeline; the track controls what human oversight follows. Assignment is driven by weighted score plus the seven escalation conditions described in the [Framework Reference](../framework/escalation-conditions.md).

## Track Summary

| Track | Label | Weighted Score | Human Review | Activation |
|-------|-------|----------------|--------------|------------|
| 1 | Register & Go | < 22% | None, unless the activation gate blocks | Auto-activates on pipeline completion; the activation gate can route it to human review instead. |
| 2 | Self-Certify | 22% - 42% | Builder reviews own findings. | Builder self-certifies to activate. |
| 3 | IT Review | 42% - 65% | IT reviewer approves. | Reviewer or admin activates after approval. |
| 4 | Formal Project | >= 65% or any escalation condition | Formal IT project governance. | Track 4 follows institutional project intake; activation requires explicit reviewer sign-off. |

## Track 1 — Register & Go

**Who lands here:** Low-risk internal tools. Typical examples: personal automation scripts, internal utilities with no data access, single-user prototypes.

**What happens:**

1. Builder submits intake.
2. Pipeline runs all four agents.
3. On pipeline completion, the tool's status transitions `in_progress` -> `active` automatically. Track 1 auto-activation is gated: intake-vs-code contradictions, confirmed critical findings, partial analysis, or truncated bundle coverage route the tool to human review instead (see the activation gate, `docs/framework/track-routing.md#activation-gate`).
4. Builder receives a `pipeline_complete` notification with a link to findings.

When the activation gate does not block, findings are informational — builders are expected to address critical and high-severity findings as a matter of practice, but there is no formal approval requirement. When the gate blocks, the tool goes to `under_review` and a reviewer decision is required before it can activate.

## Track 2 — Self-Certify

**Who lands here:** Moderate-risk tools. Typical examples: internal apps with institutional data, scripts that touch SSO-protected systems, small-audience AI helpers.

**What happens:**

1. Builder submits intake.
2. Pipeline runs.
3. On completion, status transitions to `under_review`.
4. Builder reviews findings on the [findings review](reviewing-findings.md) page.
5. Builder clicks **Self-Certify & Activate** in the review panel. Status transitions to `active`.
6. Reviewers and admins receive a `tool_activated` notification.

Self-certification is a compliance action: the builder attests that findings have been reviewed and that remediation decisions are documented. A reviewer or admin can later move the tool back to `under_review` if audit surfaces concerns.

**Only the tool owner can self-certify.** Admins can force the state transition through the status change endpoint, but this is logged as an override in the audit log.

## Track 3 — IT Review

**Who lands here:** Higher-risk tools. Typical examples: public-facing apps, tools handling FERPA data with authentication, AI agents with broad audience reach.

**What happens:**

1. Builder submits intake.
2. Pipeline runs.
3. On completion, status transitions to `under_review`.
4. Reviewers receive a `review_needed` notification.
5. A reviewer reads findings, posts notes, and renders a decision: `approved` or `changes_requested`.
6. If approved, a reviewer or admin clicks **Activate Tool**. Status transitions to `active`.
7. If changes requested, status transitions to `changes_requested`. The builder addresses findings, updates the code, and resubmits. Status returns to `pending`.

Critical and high-severity findings from the pipeline should be resolved before approval. Reviewers use the [review decisions](review-decisions.md) flow to document their reasoning.

## Track 4 — Formal Project

**Who lands here:** High-risk tools or any tool that triggers an escalation condition.

**What happens:**

1. Builder submits intake.
2. The intake form displays an escalation banner indicating formal project governance is required.
3. Pipeline runs (findings are still useful input to the formal review).
4. Builder is expected to engage IT directly through the institutional project intake process before proceeding.
5. Within the portal, status follows the same `under_review` -> `approved` -> `active` flow as Track 3, but approval typically requires project-level documentation attached externally.

Escalation-driven Track 4 assignments cannot be lowered automatically. A reviewer or admin can issue a [track override](review-decisions.md#track-override) with a documented reason, but the original escalation is retained in the audit log.

## Track Override

Reviewers and admins can escalate or de-escalate any tool at any time, provided they supply a reason. Override details:

- The override creates a `track_override` review note visible to all parties.
- The `audit_log` records the from/to track and the justification.
- The tool owner receives a `track_override` notification.
- Override does not re-run the pipeline automatically. If the reviewer decides a lower track warrants a different pipeline analysis, they must trigger a retry manually.

See [Review Decisions](review-decisions.md#track-override) for the full override workflow.

## Status State Machine by Track

```text
Common flow (all tracks):
  draft -> pending -> in_progress

Track 1:
  in_progress -> active (automatic)

Track 2:
  in_progress -> under_review -> active (self-certify)
                            -> changes_requested -> pending -> ...

Track 3 and Track 4:
  in_progress -> under_review -> approved -> active (reviewer activates)
                            -> changes_requested -> pending -> ...
```

Additional terminal states for active tools:

- `suspended` — a reviewer or admin has temporarily disabled the tool (e.g., incident response).
- `retired` — the tool is decommissioned.

## What to Expect as a Builder

| Your Track | What You Do | Turnaround |
|------------|-------------|------------|
| 1 | Review findings as a matter of practice. | Immediate. |
| 2 | Review findings, click Self-Certify. | Self-paced. |
| 3 | Wait for reviewer. Respond to comments. Address any requested changes. | Depends on reviewer queue. |
| 4 | Engage IT through formal project intake. Findings feed that conversation. | Scheduled via IT. |

## What to Expect as a Reviewer

| Track | Your Action |
|-------|-------------|
| 1 | Nothing required. |
| 2 | Optional: audit self-certified tools. |
| 3 | Triage findings, render decision. |
| 4 | Formal project review. Findings are input, not the decision. |

See [Review Decisions](review-decisions.md) for the reviewer workflow.

## Related Reading

- [Scoring Model](scoring-model.md) — how weighted scores are computed.
- [Reviewing Findings](reviewing-findings.md) — the triage workflow.
- [Review Decisions](review-decisions.md) — reviewer actions.
- [Framework Reference: Track Routing](../framework/track-routing.md) — policy-level rationale.
