-- Add ON_HOLD status to tasks
-- ON_HOLD represents tasks that are temporarily paused/suspended

-- Drop the existing constraint and add the new one with ON_HOLD
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('BACKLOG', 'PLANNED', 'IN_PROGRESS', 'BLOCKED', 'ON_HOLD', 'DONE'));
