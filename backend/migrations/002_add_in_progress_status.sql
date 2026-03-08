-- Add 'in_progress' to tools status to reflect active pipeline runs
ALTER TABLE tools DROP CONSTRAINT IF EXISTS tools_status_check;
ALTER TABLE tools ADD CONSTRAINT tools_status_check
  CHECK (status IN ('draft', 'pending', 'in_progress', 'active', 'under_review', 'suspended', 'retired'));
