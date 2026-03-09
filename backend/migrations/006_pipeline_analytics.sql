-- Migration 006: Pipeline analytics — enrich pass_results, add cost tracking

-- Add analytics columns to pass_results
ALTER TABLE pass_results ADD COLUMN IF NOT EXISTS json_parsed BOOLEAN DEFAULT false;
ALTER TABLE pass_results ADD COLUMN IF NOT EXISTS output_bytes INTEGER DEFAULT 0;
ALTER TABLE pass_results ADD COLUMN IF NOT EXISTS error_category TEXT
  CHECK (error_category IN ('timeout', 'parse_error', 'api_error', 'cancelled', 'unknown', NULL));
ALTER TABLE pass_results ADD COLUMN IF NOT EXISTS retry_of UUID REFERENCES pass_results(id);

-- Per-run summary metrics (computed after pipeline completes)
CREATE TABLE IF NOT EXISTS pipeline_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL UNIQUE REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  total_elapsed_seconds REAL,
  queue_wait_seconds REAL,
  estimated_cost_usd REAL,
  models_succeeded INTEGER DEFAULT 0,
  models_failed INTEGER DEFAULT 0,
  passes_total INTEGER DEFAULT 0,
  passes_succeeded INTEGER DEFAULT 0,
  json_parse_failures INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_metrics_run ON pipeline_metrics(run_id);
CREATE INDEX IF NOT EXISTS idx_pass_results_model ON pass_results(model_name);
CREATE INDEX IF NOT EXISTS idx_pass_results_status ON pass_results(status);
CREATE INDEX IF NOT EXISTS idx_pass_results_completed ON pass_results(completed_at);
