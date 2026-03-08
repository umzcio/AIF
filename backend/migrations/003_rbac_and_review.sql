-- Phase 1: RBAC and Review schema additions

-- Expand tools status to include review workflow statuses
ALTER TABLE tools DROP CONSTRAINT IF EXISTS tools_status_check;
ALTER TABLE tools ADD CONSTRAINT tools_status_check
  CHECK (status IN ('draft','pending','in_progress','active',
    'under_review','approved','changes_requested','suspended','retired'));

-- Review decision tracking on tools
ALTER TABLE tools ADD COLUMN IF NOT EXISTS review_decision TEXT;
ALTER TABLE tools ADD COLUMN IF NOT EXISTS review_decided_at TIMESTAMPTZ;
ALTER TABLE tools ADD COLUMN IF NOT EXISTS review_decided_by INTEGER REFERENCES users(id);

-- Review notes / comment thread
CREATE TABLE IF NOT EXISTS review_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id UUID NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  note_type TEXT NOT NULL DEFAULT 'comment'
    CHECK (note_type IN ('comment','status_change','track_override','system')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id),
  actor_netid TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User soft-deactivation
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_review_notes_tool ON review_notes(tool_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
