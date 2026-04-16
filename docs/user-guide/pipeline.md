# Watching the Pipeline Run

The pipeline page shows live progress of a submitted tool through the four-agent analysis. Events stream over Server-Sent Events (SSE), so progress updates appear without refreshing. Builders can leave the page safely; the pipeline continues server-side.

## The Four Agents

| # | Agent | Passes | What It Produces |
|---|-------|:------:|------------------|
| 1 | Code & Security Analysis | 5 | Findings across inventory, services, data operations, auth, secrets, AI usage, MCP/agent security, plus dimension score signals. |
| 2 | Accessibility Audit | 5 | WCAG 2.2 AA findings: ARIA, keyboard, contrast, structure, forms, images, dynamic content, modals, responsive. |
| 3 | QA / Bug Detection | 5 | Logic bugs, error handling, async/concurrency, edge cases, type safety, resource management, API contracts, state management, failure modes. |
| 4 | Documentation Generation | 1 | USER_GUIDE.md, ADMIN_GUIDE.md, COMPLIANCE_SUMMARY.md, plus HECVAT 4.15 self-assessment. |

Agents 1-3 are multi-model: five different models independently analyze the same codebase and their outputs are synthesized by Claude. A finding is confirmed if 3 or more passes flagged it, potential if 1-2, and clean if 0.

## Navigating to the Pipeline Page

Automatically opens after code upload. Direct URL:

```text
#/tool/<toolId>/pipeline/<runId>
```

The page stays on this URL until the run completes or is cancelled. Once complete, a button to open the report appears at the bottom.

## Page Layout

The page has four main areas:

1. **Header** — Tool name, track badge, current run status, and retry counter if applicable.
2. **Summary grid** — Started time, elapsed timer, agent count, event count.
3. **Agent progress** — Per-agent cards showing pass count, retry count, and running/done/failed state.
4. **Recent activity** — Reverse-chronological feed of the last eight events.

An elapsed timer ticks every second while the run is live.

## Live Event Types

The SSE stream delivers typed events:

| Event Type | Meaning |
|------------|---------|
| `agent_start` | Agent has begun execution. |
| `pass_complete` | A single model pass finished. Includes elapsed time. |
| `pass_retry` | A pass failed and is being retried (max 1 retry per pass). |
| `agent_complete` | Agent finished. `partial: true` if fewer than all passes succeeded but synthesis proceeded. |
| `status` | Overall run status change: `running`, `completed`, `failed`, `cancelled`. |

## Per-Pass Behavior

- **Timeouts.** Each model has its own timeout: Codex 15 min, Claude 15 min, Kimi 12 min, Gemini/Qwen 8 min, Grok 3 min.
- **Retries.** A failed pass retries once with backoff. If it fails both attempts, the agent proceeds with partial results provided at least 4 of 5 passes succeeded.
- **Partial synthesis.** When only 4 passes complete, the synthesis step labels the agent output `partial` and the event stream carries that flag.

## Safe to Leave

A green banner reads **Safe to leave. The pipeline continues server-side.** while the run is active. Closing the browser or navigating away does not kill the run. On return, the page reconnects to the SSE stream.

If the SSE connection drops mid-run, a **Connection lost. Refresh to check status.** banner appears. Refreshing re-establishes the stream without restarting the pipeline.

## Cancelling a Run

The **Cancel pipeline** button appears while the run is active and the user has permission (owner or reviewer/admin).

Cancellation:

- Sends SIGTERM to all active child processes, escalating to SIGKILL if they do not exit.
- Sets run status to `cancelled`.
- Writes a cancellation event to the SSE stream.
- Does not bill for unstarted model passes.

Cancellation is recorded in the `audit_log`. After cancellation, the retry button appears.

## Retrying a Run

Retry is available when a run is `failed` or `cancelled` and has fewer than 2 retries. Clicking **Retry run**:

- Creates a new `pipeline_runs` record linked to the original via `parent_run_id`.
- Navigates to the new run's pipeline page.
- Resets per-pass timers and begins execution.

After 2 total failures, retry is disabled. The message `Max retries reached. Investigate the issue before retrying.` appears. An admin can inspect the pipeline analytics dashboard for root cause, or the `pass_results` table via the API.

## Status Outcomes

At end of run, the header renders one of:

| Header | Meaning |
|--------|---------|
| Analysis complete | All agents finished. Open report to view findings. |
| Analysis cancelled | User or admin cancelled. |
| Analysis failed | Pipeline errored unrecoverably. See error message and logs. |

Completed runs unlock the **Open report** button in the page actions area.

## Accessibility

- Agent progress bars carry `role="progressbar"` with live `aria-valuenow`.
- The agent-progress section is marked `aria-live="polite"` so screen readers announce status changes without interrupting context.
- Status banners use `role="status"` or `role="alert"` as appropriate.
- The elapsed timer is screen-reader accessible via monospace text inside the card.

## Troubleshooting

| Symptom | Likely Cause | Action |
|---------|--------------|--------|
| Pipeline stuck at `queued` | Job queue worker not consuming. | Ask an admin to inspect job queue health. |
| One agent fails, others succeed | API provider timeout or rate limit. | Retry the run. See provider status in analytics. |
| Synthesis fails with valid pass results | Claude CLI environment misconfigured. | Admin: verify `ANTHROPIC_API_KEY` and Claude CLI installation. |
| Partial results on every run | Persistent provider issue. | Admin: check provider smoke tests via `npm run test:providers` in the backend. |

## Related Reading

- [Reviewing Findings](reviewing-findings.md) — what to do after the pipeline completes.
- [Architecture: Pipeline](../architecture/pipeline.md) — internal design of the orchestrator and queue.
- [Admin Guide: Pipeline Analytics](../admin-guide/pipeline-analytics.md) — per-model performance and cost tracking.
