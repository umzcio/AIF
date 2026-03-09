-- Add ON DELETE CASCADE to pipeline_runs.tool_id so deleting a tool
-- cascades through pipeline_runs → agent_results, pass_results, pipeline_metrics.
-- Other FKs (notifications.tool_id, review_notes.tool_id) already have CASCADE.

ALTER TABLE pipeline_runs DROP CONSTRAINT IF EXISTS pipeline_runs_tool_id_fkey;
ALTER TABLE pipeline_runs
  ADD CONSTRAINT pipeline_runs_tool_id_fkey
  FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE;
