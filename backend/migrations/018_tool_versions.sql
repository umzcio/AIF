-- Snapshot of a tool's scoring state before each resubmission recompute.
-- Makes the versioning promise in escalation-conditions.md true.
CREATE TABLE IF NOT EXISTS tool_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id UUID NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  intake_answers JSONB,
  dimension_scores JSONB,
  weighted_percentage NUMERIC(5,2),
  escalation_conditions JSONB,
  floor_conditions JSONB,
  track INTEGER,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tool_id, version)
);
CREATE INDEX IF NOT EXISTS idx_tool_versions_tool ON tool_versions (tool_id, version);
