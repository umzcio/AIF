-- Result of the Track 1 auto-activation gate (contradictions, criticals, coverage)
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS activation_gate JSONB;
