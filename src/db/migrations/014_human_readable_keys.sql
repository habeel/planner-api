-- Migration: 014_human_readable_keys.sql
-- Adds human-readable keys (P-1, E-1, T-1) to projects, epics, and tasks

-- ============================================
-- STEP 1: Create sequence counter table
-- ============================================
CREATE TABLE workspace_sequences (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    entity_type VARCHAR(10) NOT NULL CHECK (entity_type IN ('project', 'epic', 'task')),
    next_val INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (workspace_id, entity_type)
);

-- ============================================
-- STEP 2: Create atomic key generation function
-- ============================================
CREATE OR REPLACE FUNCTION get_next_key(p_workspace_id UUID, p_entity_type VARCHAR(10))
RETURNS INTEGER AS $$
DECLARE
    v_next INTEGER;
BEGIN
    -- Insert with next_val=2 (so we return 1 on first call)
    -- Or increment existing and return the pre-increment value
    INSERT INTO workspace_sequences (workspace_id, entity_type, next_val)
    VALUES (p_workspace_id, p_entity_type, 2)
    ON CONFLICT (workspace_id, entity_type)
    DO UPDATE SET next_val = workspace_sequences.next_val + 1
    RETURNING next_val - 1 INTO v_next;

    RETURN v_next;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- STEP 3: Add key columns (nullable initially for backfill)
-- ============================================
ALTER TABLE projects ADD COLUMN key VARCHAR(20);
ALTER TABLE epics ADD COLUMN key VARCHAR(20);
ALTER TABLE tasks ADD COLUMN key VARCHAR(20);

-- ============================================
-- STEP 4: Backfill existing projects
-- ============================================
WITH numbered_projects AS (
    SELECT
        id,
        workspace_id,
        ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY created_at, id) as rn
    FROM projects
    WHERE key IS NULL
)
UPDATE projects p
SET key = 'P-' || np.rn
FROM numbered_projects np
WHERE p.id = np.id;

-- Update sequence counters for projects
INSERT INTO workspace_sequences (workspace_id, entity_type, next_val)
SELECT
    workspace_id,
    'project',
    COALESCE(MAX(CAST(SUBSTRING(key FROM 3) AS INTEGER)), 0) + 1
FROM projects
WHERE key IS NOT NULL
GROUP BY workspace_id
ON CONFLICT (workspace_id, entity_type)
DO UPDATE SET next_val = EXCLUDED.next_val;

-- ============================================
-- STEP 5: Backfill existing epics
-- ============================================
WITH numbered_epics AS (
    SELECT
        id,
        workspace_id,
        ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY created_at, id) as rn
    FROM epics
    WHERE key IS NULL
)
UPDATE epics e
SET key = 'E-' || ne.rn
FROM numbered_epics ne
WHERE e.id = ne.id;

-- Update sequence counters for epics
INSERT INTO workspace_sequences (workspace_id, entity_type, next_val)
SELECT
    workspace_id,
    'epic',
    COALESCE(MAX(CAST(SUBSTRING(key FROM 3) AS INTEGER)), 0) + 1
FROM epics
WHERE key IS NOT NULL
GROUP BY workspace_id
ON CONFLICT (workspace_id, entity_type)
DO UPDATE SET next_val = EXCLUDED.next_val;

-- ============================================
-- STEP 6: Backfill existing tasks
-- ============================================
WITH numbered_tasks AS (
    SELECT
        id,
        workspace_id,
        ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY created_at, id) as rn
    FROM tasks
    WHERE key IS NULL
)
UPDATE tasks t
SET key = 'T-' || nt.rn
FROM numbered_tasks nt
WHERE t.id = nt.id;

-- Update sequence counters for tasks
INSERT INTO workspace_sequences (workspace_id, entity_type, next_val)
SELECT
    workspace_id,
    'task',
    COALESCE(MAX(CAST(SUBSTRING(key FROM 3) AS INTEGER)), 0) + 1
FROM tasks
WHERE key IS NOT NULL
GROUP BY workspace_id
ON CONFLICT (workspace_id, entity_type)
DO UPDATE SET next_val = EXCLUDED.next_val;

-- ============================================
-- STEP 7: Add NOT NULL constraints
-- ============================================
ALTER TABLE projects ALTER COLUMN key SET NOT NULL;
ALTER TABLE epics ALTER COLUMN key SET NOT NULL;
ALTER TABLE tasks ALTER COLUMN key SET NOT NULL;

-- ============================================
-- STEP 8: Create unique indexes
-- ============================================
CREATE UNIQUE INDEX idx_projects_workspace_key ON projects(workspace_id, key);
CREATE UNIQUE INDEX idx_epics_workspace_key ON epics(workspace_id, key);
CREATE UNIQUE INDEX idx_tasks_workspace_key ON tasks(workspace_id, key);
