-- Migration: 006_fix_time_off.sql
-- Description: Add workspace_id to time_off table for proper data isolation

-- Add workspace_id column to time_off
ALTER TABLE time_off ADD COLUMN workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;

-- Create index for workspace filtering
CREATE INDEX idx_time_off_workspace ON time_off(workspace_id);

-- Note: Backfill existing data manually if needed
-- For existing time_off entries, you may need to determine which workspace they belong to
-- based on the user's workspace memberships. This is application-specific.

-- Example backfill (commented out - run manually if needed):
-- UPDATE time_off t
-- SET workspace_id = (
--   SELECT uwr.workspace_id
--   FROM user_workspace_roles uwr
--   WHERE uwr.user_id = t.user_id
--   LIMIT 1
-- )
-- WHERE t.workspace_id IS NULL;

-- After backfill, you can make the column required:
-- ALTER TABLE time_off ALTER COLUMN workspace_id SET NOT NULL;
