-- Migration 011: Add pipeline_mode column to pipeline_runs
-- Supports toggling between standard (direct CLI) and opencode (agent orchestration) modes.

ALTER TABLE pipeline_runs ADD COLUMN pipeline_mode VARCHAR(20) NOT NULL DEFAULT 'standard';
