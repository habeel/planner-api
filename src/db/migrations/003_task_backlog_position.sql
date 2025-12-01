-- Add position_in_backlog column to track backlog task ordering
-- This field is only meaningful when start_date IS NULL (task is in backlog)
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS position_in_backlog INTEGER DEFAULT NULL;

-- Index for efficient sorting of backlog tasks by position
CREATE INDEX IF NOT EXISTS idx_tasks_backlog_position
ON tasks(workspace_id, position_in_backlog ASC NULLS LAST)
WHERE start_date IS NULL;
