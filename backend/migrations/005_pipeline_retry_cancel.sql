-- Pipeline retry, cancel & per-pass recovery support

ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS parent_run_id UUID REFERENCES pipeline_runs(id);

-- Per-pass results tracking for retry/partial results
CREATE TABLE IF NOT EXISTS pass_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  pass_key TEXT NOT NULL,
  model_name TEXT NOT NULL,
  tool TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  attempt INTEGER NOT NULL DEFAULT 1,
  elapsed_seconds REAL,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (run_id, agent_name, pass_key, attempt)
);

CREATE INDEX IF NOT EXISTS idx_pass_results_run ON pass_results (run_id, agent_name);
