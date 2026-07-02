-- Prevent duplicate concurrent runs for one tool (double-click / rapid retry).
-- Race-proof backstop for the application-level check in queue.js enqueue():
-- that check is SELECT-then-INSERT (TOCTOU), so two racing enqueue() calls can
-- both pass the SELECT; this partial unique index makes the second INSERT fail
-- with a unique-violation (23505) instead of creating a second active run.

-- Pre-existing duplicates were possible before this changeset (enqueue() had no
-- guard at all), so make the index creation self-healing rather than relying on
-- a point-in-time "prod is clean right now" check: keep the most-recently-queued
-- active run per tool and supersede any others so CREATE UNIQUE INDEX can't fail
-- on data that drifted between review and deploy.
UPDATE pipeline_runs pr
SET status = 'cancelled',
    error_message = 'Superseded by duplicate active run (migration 019 cleanup)',
    completed_at = NOW()
WHERE status IN ('queued', 'running')
  AND id NOT IN (
    SELECT DISTINCT ON (tool_id) id
    FROM pipeline_runs
    WHERE status IN ('queued', 'running')
    ORDER BY tool_id, queued_at DESC
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_runs_active_one_per_tool
  ON pipeline_runs (tool_id) WHERE status IN ('queued', 'running');
