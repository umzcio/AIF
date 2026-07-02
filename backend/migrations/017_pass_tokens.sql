-- Actual token usage per pass (direct-API passes; CLI passes remain NULL)
ALTER TABLE pass_results ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER;
ALTER TABLE pass_results ADD COLUMN IF NOT EXISTS completion_tokens INTEGER;
