-- Add link column to notifications for frontend navigation
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT;

-- Default email notifications to off (users must opt in)
ALTER TABLE users ALTER COLUMN notify_email SET DEFAULT false;
