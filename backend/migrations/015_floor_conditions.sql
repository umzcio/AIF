-- Floor conditions: minimum-track constraints that raise but never force Track 4
ALTER TABLE tools ADD COLUMN IF NOT EXISTS floor_conditions JSONB DEFAULT '[]';
