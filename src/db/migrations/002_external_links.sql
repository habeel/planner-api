-- Add credentials column to integrations table for storing PAT/OAuth tokens
ALTER TABLE integrations
ADD COLUMN IF NOT EXISTS credentials JSONB;

-- Add enabled flag to integrations
ALTER TABLE integrations
ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT true;

-- Task external links table for linking planning tasks to GitHub/Jira issues
CREATE TABLE IF NOT EXISTS task_external_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'jira')),
  external_id TEXT NOT NULL, -- GitHub issue number as string, or Jira key like "PROJ-123"
  external_url TEXT NOT NULL,
  title TEXT, -- Cached title from external system
  status TEXT, -- Cached status from external system
  synced_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(task_id, provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_task_external_links_task ON task_external_links(task_id);
CREATE INDEX IF NOT EXISTS idx_task_external_links_provider ON task_external_links(provider);
CREATE INDEX IF NOT EXISTS idx_task_external_links_external ON task_external_links(provider, external_id);
