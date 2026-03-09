-- Performance indexes for analytics, admin queries, and pipeline operations.

-- Tools: owner scoping + status filtering (registry list, admin user tool counts)
CREATE INDEX IF NOT EXISTS idx_tools_owner_status ON tools(owner_id, status);

-- Pass results: model-level analytics aggregations
CREATE INDEX IF NOT EXISTS idx_pass_results_model_completed ON pass_results(model_name, created_at);

-- Pipeline runs: retry lookups via parent chain
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_parent ON pipeline_runs(parent_run_id) WHERE parent_run_id IS NOT NULL;

-- Notifications: unread count badge queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read);

-- Audit log: time-range filtering (admin audit tab)
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

-- Pipeline runs: queued_at for analytics time-range queries
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_queued ON pipeline_runs(queued_at DESC);
