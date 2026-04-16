-- Migration 014: Set pipeline_mode default to 'direct-api'
-- Legacy modes (standard, opencode) are no longer supported.
-- Existing historical rows retain their original mode values.
ALTER TABLE pipeline_runs ALTER COLUMN pipeline_mode SET DEFAULT 'direct-api';
