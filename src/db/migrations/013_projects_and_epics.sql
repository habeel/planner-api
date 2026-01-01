-- ============================================
-- PROJECTS TABLE
-- ============================================
-- Top-level container for large initiatives
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    goals TEXT,
    status VARCHAR(50) DEFAULT 'planning',
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN projects.status IS 'planning | active | on_hold | completed | cancelled';
COMMENT ON COLUMN projects.goals IS 'High-level success criteria and objectives';

CREATE INDEX idx_projects_workspace_id ON projects(workspace_id);
CREATE INDEX idx_projects_status ON projects(status);

-- ============================================
-- EPICS TABLE
-- ============================================
-- Large chunks of work within a project
CREATE TABLE epics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'draft',
    priority VARCHAR(20) DEFAULT 'MED',
    estimated_weeks DECIMAL(4,1),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN epics.status IS 'draft | ready_for_breakdown | breaking_down | ready | in_progress | done';
COMMENT ON COLUMN epics.priority IS 'LOW | MED | HIGH | CRITICAL';
COMMENT ON COLUMN epics.estimated_weeks IS 'Rough estimate in weeks (T-shirt sizing)';

CREATE INDEX idx_epics_project_id ON epics(project_id);
CREATE INDEX idx_epics_workspace_id ON epics(workspace_id);
CREATE INDEX idx_epics_status ON epics(status);

-- ============================================
-- EPIC DEPENDENCIES
-- ============================================
-- Track which epics depend on others
CREATE TABLE epic_dependencies (
    epic_id UUID NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
    depends_on_epic_id UUID NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
    dependency_type VARCHAR(20) DEFAULT 'blocks',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (epic_id, depends_on_epic_id),
    CHECK (epic_id != depends_on_epic_id)
);

-- Dependency types:
-- - blocks: Cannot start until dependency is done
-- - related: Loosely related, should be aware of
-- - informs: Dependency provides context/decisions needed
COMMENT ON COLUMN epic_dependencies.dependency_type IS 'blocks | related | informs';

-- ============================================
-- LINK TASKS TO EPICS
-- ============================================
-- Allow existing tasks to belong to an epic
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS epic_id UUID REFERENCES epics(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_epic_id ON tasks(epic_id);

-- ============================================
-- LINK AI CONVERSATIONS TO PROJECTS
-- ============================================
-- Enable project-scoped AI conversations
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ai_conversations_project_id ON ai_conversations(project_id);

-- ============================================
-- TRIGGER FOR updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_epics_updated_at
    BEFORE UPDATE ON epics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
