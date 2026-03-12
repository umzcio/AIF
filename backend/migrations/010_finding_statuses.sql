-- Finding status tracking: persists user-set open/resolved/wontfix status per finding
CREATE TABLE IF NOT EXISTS finding_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id UUID NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  finding_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'wontfix')),
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tool_id, finding_id)
);

CREATE INDEX idx_finding_statuses_tool ON finding_statuses(tool_id);
