-- users (synced from CAS on first login)
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  netid VARCHAR(50) UNIQUE NOT NULL,
  display_name VARCHAR(255),
  role VARCHAR(20) NOT NULL DEFAULT 'builder'
    CHECK (role IN ('builder', 'reviewer', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ
);

-- tools (registry)
CREATE TABLE tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  owner_id INTEGER REFERENCES users(id),
  submission_type TEXT NOT NULL DEFAULT 'new'
    CHECK (submission_type IN ('new', 'change', 'retroactive')),
  artifact_type TEXT
    CHECK (artifact_type IN ('public-site', 'internal-app', 'script-api', 'ai-agent', 'data-pipeline', 'other')),
  intake_answers JSONB,
  score_security INTEGER CHECK (score_security BETWEEN 0 AND 3),
  score_accessibility INTEGER CHECK (score_accessibility BETWEEN 0 AND 3),
  score_data_sensitivity INTEGER CHECK (score_data_sensitivity BETWEEN 0 AND 3),
  score_blast_radius INTEGER CHECK (score_blast_radius BETWEEN 0 AND 3),
  score_autonomy INTEGER CHECK (score_autonomy BETWEEN 0 AND 3),
  score_comprehension INTEGER CHECK (score_comprehension BETWEEN 0 AND 3),
  score_maintenance INTEGER CHECK (score_maintenance BETWEEN 0 AND 3),
  weighted_percentage NUMERIC(5,2),
  escalation_conditions JSONB DEFAULT '[]',
  has_escalation BOOLEAN GENERATED ALWAYS AS (
    jsonb_array_length(COALESCE(escalation_conditions, '[]'::jsonb)) > 0
  ) STORED,
  track INTEGER CHECK (track BETWEEN 1 AND 4),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('draft', 'pending', 'active', 'under_review', 'suspended', 'retired')),
  codebase_url TEXT,
  codebase_path TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- pipeline_runs
CREATE TABLE pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id UUID NOT NULL REFERENCES tools(id),
  track INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  current_agent TEXT,
  current_agent_index INTEGER DEFAULT 0,
  total_agents INTEGER DEFAULT 4,
  output_dir TEXT,
  error_message TEXT,
  summary JSONB,
  queued_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- agent_results (one per agent per run)
CREATE TABLE agent_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  agent_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  passes_completed INTEGER DEFAULT 0,
  passes_total INTEGER DEFAULT 0,
  result_json JSONB,
  output_files JSONB DEFAULT '[]',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX idx_tools_track ON tools(track);
CREATE INDEX idx_pipeline_runs_tool ON pipeline_runs(tool_id);
CREATE INDEX idx_pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX idx_agent_results_run ON agent_results(run_id);
