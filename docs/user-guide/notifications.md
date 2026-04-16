# Notifications

AIF delivers notifications both in-app (via the bell icon in the top bar) and by email. Each user controls their own delivery preferences. This page documents the event types that trigger notifications, how to manage preferences, and the in-app dropdown behavior.

## The Notification Bell

The bell icon lives in the top bar on every page. An unread count badge appears on the bell when there are unread notifications (capped visually at `99+`).

Clicking the bell opens a 360px-wide dropdown dialog with two tabs:

- **Notifications** — up to 20 most recent notifications, reverse-chronological.
- **Settings** — email address and delivery preferences.

The dropdown polls for new notifications every 30 seconds while open and on initial page load.

## Notification Types

The portal emits seven notification types. Each has an icon and color:

| Type | Trigger | Recipient |
|------|---------|-----------|
| `pipeline_complete` | All four agents finish on a pipeline run. | Tool owner. |
| `review_needed` | Tool enters `under_review`. | Reviewers (role broadcast). |
| `review_approved` | Reviewer approves the tool. | Tool owner. |
| `review_changes_requested` | Reviewer requests changes. | Tool owner. |
| `track_override` | Track is overridden by a reviewer or admin. | Tool owner. |
| `tool_activated` | Tool transitions to `active`. | Tool owner (and broadcast to reviewers/admins when self-certified). |
| `comment` | Someone posts a comment on the tool. | Tool owner (unless they wrote the comment). |

Each notification carries a title, optional body, link to the relevant tool page, and a `read` flag.

## In-App Delivery

When a notification fires, a row is inserted into the `notifications` table. The bell dropdown surfaces it via the polling mechanism.

Dropdown behavior:

- Unread items display with a filled background and a blue dot on the right.
- Clicking a notification marks it read and navigates to the stored link (typically the tool detail page).
- A **Mark all read** check-check icon appears when any unread items exist.
- The dialog has a focus trap; Tab and Shift+Tab cycle within the dropdown. Escape closes and returns focus to the bell.

## Email Delivery

Email notifications are opt-in. The portal requires two things to send email:

1. A configured SMTP server (admin-level configuration).
2. The user has enabled email delivery and provided a valid email address.

When both conditions are met, each in-app notification also dispatches an HTML email with:

- Subject prefix `[AIF]`.
- A short HTML body with the notification title, body, and a "View in Portal" button linking to the full URL.
- Plain-text fallback for non-HTML mail clients.

The `notifications` table tracks `email_sent = true` per notification so repeat attempts are not made.

Email delivery failures do not block the in-app notification. If SMTP is down, the in-app notification still appears; the email simply does not go out and a log entry records the failure.

## Preferences

Open the bell, then click the **Settings** tab. Three controls:

### Email Address

Auto-populated from the user's NetID (format: `<netid>@institution.edu`). Editable. Common reasons to change:

- Preferred forwarding address.
- Institutional email not the same as NetID format.

Changes take effect immediately on save.

### In-App Notifications (Checkbox)

Default: on.

Disabling does not delete existing notifications. The bell still surfaces any notification already in the table; new inserts are skipped.

### Email Notifications (Checkbox)

Default: off.

Enable to receive email for each notification. If the email field is blank, the preference is ignored.

### Save Preferences

Click **Save Preferences** after making changes. The button shows `Saving...` during the request and returns to `Save Preferences` on completion. Errors surface as a toast.

## Managing Unread Count

- **Mark one as read** — Click any unread notification.
- **Mark all as read** — Click the double-check icon in the dropdown header.
- **Reset unread** — There is no "mark as unread." The unread state is automatic on creation and transitions to read only through the above actions.

## Notification Lifecycle

| Step | Behavior |
|------|----------|
| Creation | Written to `notifications` with `read = false`. |
| Delivery | In-app: served by polling. Email: queued synchronously if preferences match. |
| Reading | User clicks the notification or marks all read. `read` set to `true`. |
| Retention | Read notifications older than 30 days are pruned by the nightly retention job. |

See [Admin Guide: Data Retention](../admin-guide/data-retention.md) for retention policy detail.

## Notification Link Format

Every notification stores a relative hash link such as `#/tool/<toolId>`. The in-app dropdown uses this to navigate on click; email uses it concatenated with `FRONTEND_URL` to produce a fully qualified URL.

If the link is missing for any reason, the fallback navigates to the tool detail page using the notification's `tool_id` field. If `tool_id` is also missing, clicking the notification marks it read but does not navigate.

## Broadcast Notifications

Two events trigger role-wide broadcasts via `notifyRole`:

- `review_needed` — Sent to every active reviewer when a tool enters `under_review`.
- `tool_activated` via self-certify — Sent to every active reviewer and admin.

Broadcasts respect each recipient's preferences. A reviewer who has disabled email will still get the in-app notification but no email.

## Accessibility

- The bell button carries `aria-label="Notifications (N unread)"` with the live count.
- The dropdown is a `role="dialog"` with `aria-modal="true"` and focus trap.
- Notification rows are buttons, keyboard-activatable with Enter or Space.
- Unread indicator is a visual dot; the `font-weight: 600` on the title provides a second unread cue.

## Troubleshooting

| Symptom | Likely Cause | Action |
|---------|--------------|--------|
| No email received despite toggle on | SMTP not configured or blocked. | Contact admin. Check spam. |
| Email received in spam | Low deliverability reputation for SMTP sender. | Admin should configure SPF/DKIM. |
| Bell shows 0 unread but dropdown has items | Count out of sync. | Close and reopen the dropdown to force re-fetch. |
| Clicking notification navigates to wrong page | Stored link is stale (tool deleted). | Mark as read manually. |

## Related Reading

- [Review Decisions](review-decisions.md) — the actions that trigger review notifications.
- [Pipeline](pipeline.md) — the source of pipeline_complete events.
- [Admin Guide: Deployment](../admin-guide/deployment.md#smtp-configuration) — SMTP setup for email delivery.
