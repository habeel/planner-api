-- Add project field to tasks table for grouping/categorization
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project VARCHAR(255);

-- Create index for efficient project-based queries and filtering
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(workspace_id, project);
