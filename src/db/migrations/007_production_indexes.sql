-- Production performance indexes
-- These indexes improve query performance for common operations

-- Task queries by workspace and assignee (for capacity calculations)
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_assignee
    ON tasks(workspace_id, assigned_to_user_id);

-- Task queries by workspace and status
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_status
    ON tasks(workspace_id, status);

-- Task queries by workspace and dates (for planning views)
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_dates
    ON tasks(workspace_id, start_date, due_date);

-- Pending invitations by organization
CREATE INDEX IF NOT EXISTS idx_invitations_pending
    ON invitations(organization_id)
    WHERE accepted_at IS NULL;

-- User lookups by email (case-insensitive)
CREATE INDEX IF NOT EXISTS idx_users_email_lower
    ON users(LOWER(email));

-- Time entries by task and date (for reports)
CREATE INDEX IF NOT EXISTS idx_time_entries_task_date
    ON time_entries(task_id, date);

-- Time entries by user and date (for user reports)
CREATE INDEX IF NOT EXISTS idx_time_entries_user_date
    ON time_entries(user_id, date);
