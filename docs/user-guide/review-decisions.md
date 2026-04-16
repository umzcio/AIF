# Review Decisions

The review panel is where reviewers and admins render decisions on Track 3 and Track 4 submissions, where Track 2 builders self-certify, and where anyone with access posts comments on a tool. This page documents the four decision types: approve, request changes, track override, and self-certify.

## Audience

This page is primarily for reviewers and admins. Builders see the review panel in read-mostly mode with the self-certify button available when applicable. The mechanics of finding triage sit in [Reviewing Findings](reviewing-findings.md).

## Where the Review Panel Appears

The panel is rendered inside the tool detail page:

```text
#/tool/<toolId>
```

Visibility rules:

| Action | Who Can See/Perform |
|--------|---------------------|
| Approve / Request Changes | Reviewers and admins, only when status = `under_review`. |
| Activate Tool | Reviewers and admins, only when status = `approved` and tool is not sandboxed. |
| Self-Certify | Tool owner, only when track = 2 and status = `under_review`. |
| Track Override | Reviewers and admins, at any time. |
| Comment thread | Tool owner, reviewers, and admins. |

## Approve or Request Changes

When a tool is `under_review`, the panel shows a decision area with:

- A **Decision notes** textarea (optional but recommended).
- Two buttons: **Approve** and **Request Changes**.

### Approve

Clicking **Approve**:

1. Transitions the tool status from `under_review` to `approved`.
2. Records a `review_approved` audit log entry.
3. Writes a status-change note to the review thread with the decision notes, if provided.
4. Sends a `review_approved` notification to the tool owner.

Approval is not the same as activation. An approved Track 3 or Track 4 tool still requires a reviewer or admin to click **Activate Tool** before it moves to `active`. Approval signals "the code is acceptable"; activation signals "the tool is now registered and in use."

### Request Changes

Clicking **Request Changes**:

1. Transitions status from `under_review` to `changes_requested`.
2. Records a `review_changes_requested` audit entry.
3. Writes a status-change note to the review thread.
4. Sends a `review_changes_requested` notification to the tool owner.

The tool owner then addresses the findings, updates the code, and resubmits. Resubmission transitions status back to `pending`, re-running the pipeline.

### Writing Good Decision Notes

Decision notes are visible to the tool owner in the comment thread. They carry the reviewer's reasoning and are the primary communication channel between roles. Recommended contents:

- Which findings must be addressed before re-review (reference finding IDs or titles).
- Which findings are acceptable as `wontfix` and why.
- Questions for the builder to clarify (data flow, ownership, user notification).
- Timeline expectations.

Avoid:

- Restating what the agent already said.
- Approving with "looks fine" — specificity matters for audit purposes.

## Activate

When a tool is `approved`, the panel shows an **Activate Tool** button. Clicking it:

1. Transitions status from `approved` to `active`.
2. Writes a status-change note and an `activate` audit entry.
3. Sends a `tool_activated` notification to the owner.

Sandbox mode blocks activation. If the tool is sandboxed, the panel shows a notice: `Sandbox mode active. Remove sandbox mode before activating.` The owner or an admin must toggle sandbox off via the tool detail page.

## Self-Certify (Track 2)

For Track 2 tools, the owner sees a **Self-Certify & Activate** button on the review panel when:

- `tool.track === 2`
- `tool.status === "under_review"`
- The logged-in user is the tool owner

Clicking **Self-Certify & Activate**:

1. Transitions status from `under_review` directly to `active`.
2. Records `review_decision = "self_certified"`.
3. Writes a self-certify note and audit entry.
4. Notifies both reviewer and admin roles that the tool is now active.

Self-certification is an attestation. By clicking the button, the builder confirms they have reviewed the pipeline findings and are accepting responsibility for any `open` or `wontfix` items. The audit trail records the action by netid and timestamp.

Reviewers cannot self-certify for a builder. Admins can technically force the state transition via the status endpoint, but this is logged as an override rather than a self-certification.

## Track Override

Either direction — up or down — is supported. The override UI is collapsed by default behind an "Override track assignment" link. Clicking expands the override form:

1. Select target track (1, 2, 3, or 4).
2. Enter a reason (required; empty reason prevents submit).
3. Click **Apply Override**.

The override:

- Updates `tools.track` directly.
- Does not alter the original dimension scores or weighted percentage. A reviewer looking at the tool later sees both the computed track and the overridden track.
- Writes a `track_override` review note with from/to metadata and the reason.
- Records a `track_override` audit entry.
- Sends a `track_override` notification to the tool owner.

### When to Override Up

- Scoring missed context (e.g., a free-text description suggests higher-sensitivity data than checkboxes captured).
- Architectural concerns not reflected in intake answers.
- Pattern of findings across similar tools.

### When to Override Down

- An escalation condition fired on a technicality but the reviewer has confirmed the condition does not apply in practice.
- The code as submitted is substantially different from what the intake described, in a way that reduces risk.
- Builder has already completed a separate formal process that the override should recognize.

### Override Does Not Re-Run the Pipeline

If a track change should change the analysis (it rarely should, since all tracks run the same pipeline), the reviewer must manually trigger a retry from the pipeline page. The override itself only affects the routing label.

## Comment Thread

The review panel displays a chronological thread combining:

- `comment` — free-text notes posted by any authorized role.
- `status_change` — auto-written when decisions or state changes occur.
- `track_override` — auto-written when a track is changed.

Each entry shows the author's netid or display name and a relative timestamp.

### Posting a Comment

Scroll to the bottom of the thread and enter text in the **Add a comment** field, then click **Post**. Comments:

- Are visible to the tool owner, reviewers, and admins.
- Trigger a `comment` notification to the tool owner (unless the owner is the author).
- Cannot be edited or deleted through the UI — this is intentional for audit trail integrity. Admins can delete entries directly in the database if absolutely required.

## Audit Trail

Every action on this page produces one or more rows in the `audit_log` table. Admins can browse the audit log from the [Admin Dashboard](../admin-guide/audit-log.md). Key actions logged:

| Action | Entity |
|--------|--------|
| `review_approved` | tool |
| `review_changes_requested` | tool |
| `track_override` | tool |
| `self_certify` | tool |
| `activate` | tool |
| `add_comment` | tool |
| `status_change` | tool |

Each entry includes actor netid, IP address, timestamp, and a JSON details payload with from/to values and any reason text.

## Error Handling

Common error cases:

| Error | Cause | Resolution |
|-------|-------|-----------|
| `Cannot review a tool with status 'X'` | Trying to decide on a tool not in `under_review`. | Refresh to see current status. |
| `Only the tool owner can self-certify` | Non-owner attempting self-certify. | Not an operator error; this is enforcement. |
| `Self-certification is only for Track 2 tools` | Wrong track. | Use Approve/Request Changes flow instead. |
| `Cannot activate a sandboxed tool` | Sandbox mode still on. | Toggle sandbox off on the tool detail page. |
| `Reason is required for track override` | Empty reason field. | Provide a justification; it becomes part of the audit trail. |

## Related Reading

- [Reviewing Findings](reviewing-findings.md) — triage workflow that feeds into decisions.
- [Tracks](tracks.md) — what each track expects from the reviewer.
- [Notifications](notifications.md) — what events reach the tool owner.
- [Admin Guide: Audit Log](../admin-guide/audit-log.md) — reviewing historical decisions.
