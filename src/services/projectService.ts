import type { FastifyInstance } from 'fastify';
import type {
  Project,
  ProjectWithEpics,
  Epic,
  EpicWithDependencies,
  EpicDependency,
  ProjectStatus,
  EpicStatus,
  EpicDependencyType,
  TaskPriority,
} from '../types/index.js';
import { generateKey, generateKeyWithClient } from '../utils/keyGenerator.js';

// Input types for service methods
export interface CreateProjectInput {
  workspace_id: string;
  name: string;
  description?: string;
  goals?: string;
  created_by: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  goals?: string;
  status?: ProjectStatus;
}

export interface CreateEpicInput {
  project_id: string;
  workspace_id: string;
  name: string;
  description?: string;
  priority?: TaskPriority;
  estimated_weeks?: number;
}

export interface UpdateEpicInput {
  name?: string;
  description?: string;
  status?: EpicStatus;
  priority?: TaskPriority;
  estimated_weeks?: number | null;
  sort_order?: number;
}

export interface CreateStoryInput {
  title: string;
  description?: string;
  estimated_hours?: number;
  priority?: TaskPriority;
}

export class ProjectService {
  constructor(private fastify: FastifyInstance) {}

  // ============================================
  // PROJECTS
  // ============================================

  async create(input: CreateProjectInput): Promise<Project> {
    const key = await generateKey(this.fastify.db, input.workspace_id, 'project');

    const result = await this.fastify.db.query<Project>(
      `INSERT INTO projects (workspace_id, name, description, goals, created_by, key)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [input.workspace_id, input.name, input.description, input.goals, input.created_by, key]
    );
    return result.rows[0]!;
  }

  /**
   * Create a project with its epics in a single transaction.
   * If any operation fails, the entire transaction is rolled back.
   */
  async createWithEpics(
    projectInput: CreateProjectInput,
    epics: Array<{ name: string; description?: string; estimated_weeks?: number }>
  ): Promise<{ project: Project; epics: Epic[] }> {
    const client = await this.fastify.db.connect();

    try {
      await client.query('BEGIN');

      // Generate project key
      const projectKey = await generateKeyWithClient(client, projectInput.workspace_id, 'project');

      // Create project
      const projectResult = await client.query<Project>(
        `INSERT INTO projects (workspace_id, name, description, goals, created_by, key)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [projectInput.workspace_id, projectInput.name, projectInput.description, projectInput.goals, projectInput.created_by, projectKey]
      );
      const project = projectResult.rows[0]!;

      // Create epics
      const createdEpics: Epic[] = [];
      for (let i = 0; i < epics.length; i++) {
        const epic = epics[i]!;
        // Generate epic key
        const epicKey = await generateKeyWithClient(client, projectInput.workspace_id, 'epic');

        const epicResult = await client.query<Epic>(
          `INSERT INTO epics (project_id, workspace_id, name, description, priority, estimated_weeks, sort_order, key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [project.id, projectInput.workspace_id, epic.name, epic.description, 'MED', epic.estimated_weeks, i + 1, epicKey]
        );
        createdEpics.push(epicResult.rows[0]!);
      }

      await client.query('COMMIT');
      return { project, epics: createdEpics };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getById(id: string): Promise<Project | null> {
    const result = await this.fastify.db.query<Project>(
      `SELECT * FROM projects WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  async getByKey(workspaceId: string, key: string): Promise<Project | null> {
    const result = await this.fastify.db.query<Project>(
      `SELECT * FROM projects WHERE workspace_id = $1 AND UPPER(key) = UPPER($2)`,
      [workspaceId, key]
    );
    return result.rows[0] || null;
  }

  /**
   * Find projects by name within a workspace (case-insensitive).
   * Returns all matches for disambiguation.
   */
  async getProjectsByName(workspaceId: string, name: string): Promise<Project[]> {
    const result = await this.fastify.db.query<Project>(
      `SELECT * FROM projects
       WHERE workspace_id = $1 AND LOWER(name) = LOWER($2)
       ORDER BY updated_at DESC`,
      [workspaceId, name]
    );
    return result.rows;
  }

  async getWithEpics(id: string, workspace_id: string): Promise<ProjectWithEpics | null> {
    const result = await this.fastify.db.query<Project>(
      `SELECT * FROM projects WHERE id = $1 AND workspace_id = $2`,
      [id, workspace_id]
    );

    if (result.rows.length === 0) return null;

    const project = result.rows[0]!;
    const epics = await this.getEpicsForProject(id, workspace_id);

    return { ...project, epics };
  }

  async list(workspace_id: string, status?: ProjectStatus): Promise<Project[]> {
    let query = `SELECT * FROM projects WHERE workspace_id = $1`;
    const params: (string | ProjectStatus)[] = [workspace_id];

    if (status) {
      query += ` AND status = $2`;
      params.push(status);
    }

    query += ` ORDER BY updated_at DESC`;

    const result = await this.fastify.db.query<Project>(query, params);
    return result.rows;
  }

  async update(id: string, workspace_id: string, input: UpdateProjectInput): Promise<Project | null> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(input.name);
    }
    if (input.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(input.description);
    }
    if (input.goals !== undefined) {
      updates.push(`goals = $${paramIndex++}`);
      values.push(input.goals);
    }
    if (input.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(input.status);
    }

    if (updates.length === 0) {
      return this.getById(id);
    }

    values.push(id, workspace_id);
    const result = await this.fastify.db.query<Project>(
      `UPDATE projects SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1}
       RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  async delete(id: string, workspace_id: string): Promise<boolean> {
    const result = await this.fastify.db.query(
      `DELETE FROM projects WHERE id = $1 AND workspace_id = $2`,
      [id, workspace_id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ============================================
  // EPICS
  // ============================================

  async createEpic(input: CreateEpicInput): Promise<Epic> {
    // Get max sort order
    const sortResult = await this.fastify.db.query<{ max: number }>(
      `SELECT COALESCE(MAX(sort_order), 0) as max FROM epics WHERE project_id = $1`,
      [input.project_id]
    );
    const sortOrder = (sortResult.rows[0]?.max ?? 0) + 1;

    // Generate epic key
    const key = await generateKey(this.fastify.db, input.workspace_id, 'epic');

    const result = await this.fastify.db.query<Epic>(
      `INSERT INTO epics (project_id, workspace_id, name, description, priority, estimated_weeks, sort_order, key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.project_id,
        input.workspace_id,
        input.name,
        input.description,
        input.priority ?? 'MED',
        input.estimated_weeks,
        sortOrder,
        key,
      ]
    );
    return result.rows[0]!;
  }

  async getEpicById(id: string): Promise<Epic | null> {
    const result = await this.fastify.db.query<Epic>(
      `SELECT * FROM epics WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  async getEpicByKey(workspaceId: string, key: string): Promise<Epic | null> {
    const result = await this.fastify.db.query<Epic>(
      `SELECT * FROM epics WHERE workspace_id = $1 AND UPPER(key) = UPPER($2)`,
      [workspaceId, key]
    );
    return result.rows[0] || null;
  }

  /**
   * Find epics by name within a workspace (case-insensitive).
   * Returns all matches for disambiguation.
   */
  async getEpicsByName(workspaceId: string, name: string): Promise<Epic[]> {
    const result = await this.fastify.db.query<Epic>(
      `SELECT * FROM epics
       WHERE workspace_id = $1 AND LOWER(name) = LOWER($2)
       ORDER BY updated_at DESC`,
      [workspaceId, name]
    );
    return result.rows;
  }

  async getEpicWithDependencies(id: string, workspace_id: string): Promise<EpicWithDependencies | null> {
    const epicResult = await this.fastify.db.query<Epic & { story_count: string }>(
      `SELECT e.*,
              (SELECT COUNT(*) FROM tasks WHERE epic_id = e.id) as story_count
       FROM epics e
       WHERE e.id = $1 AND e.workspace_id = $2`,
      [id, workspace_id]
    );

    if (epicResult.rows.length === 0) return null;

    const epic = epicResult.rows[0]!;
    const story_count = parseInt(epic.story_count, 10);

    // Get dependencies
    const depsResult = await this.fastify.db.query<EpicDependency>(
      `SELECT * FROM epic_dependencies WHERE epic_id = $1`,
      [id]
    );

    // Get dependents (epics that depend on this one)
    const dependentsResult = await this.fastify.db.query<EpicDependency>(
      `SELECT * FROM epic_dependencies WHERE depends_on_epic_id = $1`,
      [id]
    );

    return {
      ...epic,
      dependencies: depsResult.rows,
      dependents: dependentsResult.rows,
      story_count,
    };
  }

  async getEpicsForProject(project_id: string, workspace_id: string): Promise<EpicWithDependencies[]> {
    const epicsResult = await this.fastify.db.query<Epic & { story_count: string }>(
      `SELECT e.*,
              (SELECT COUNT(*) FROM tasks WHERE epic_id = e.id) as story_count
       FROM epics e
       WHERE e.project_id = $1 AND e.workspace_id = $2
       ORDER BY e.sort_order`,
      [project_id, workspace_id]
    );

    const epics: EpicWithDependencies[] = [];

    for (const row of epicsResult.rows) {
      const depsResult = await this.fastify.db.query<EpicDependency>(
        `SELECT * FROM epic_dependencies WHERE epic_id = $1`,
        [row.id]
      );

      const dependentsResult = await this.fastify.db.query<EpicDependency>(
        `SELECT * FROM epic_dependencies WHERE depends_on_epic_id = $1`,
        [row.id]
      );

      epics.push({
        ...row,
        dependencies: depsResult.rows,
        dependents: dependentsResult.rows,
        story_count: parseInt(row.story_count, 10),
      });
    }

    return epics;
  }

  async updateEpic(id: string, workspace_id: string, input: UpdateEpicInput): Promise<Epic | null> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(input.name);
    }
    if (input.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(input.description);
    }
    if (input.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(input.status);
    }
    if (input.priority !== undefined) {
      updates.push(`priority = $${paramIndex++}`);
      values.push(input.priority);
    }
    if (input.estimated_weeks !== undefined) {
      updates.push(`estimated_weeks = $${paramIndex++}`);
      values.push(input.estimated_weeks);
    }
    if (input.sort_order !== undefined) {
      updates.push(`sort_order = $${paramIndex++}`);
      values.push(input.sort_order);
    }

    if (updates.length === 0) {
      return this.getEpicById(id);
    }

    values.push(id, workspace_id);
    const result = await this.fastify.db.query<Epic>(
      `UPDATE epics SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1}
       RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  async deleteEpic(id: string, workspace_id: string): Promise<boolean> {
    const result = await this.fastify.db.query(
      `DELETE FROM epics WHERE id = $1 AND workspace_id = $2`,
      [id, workspace_id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ============================================
  // DEPENDENCIES
  // ============================================

  async addDependency(
    epic_id: string,
    depends_on_epic_id: string,
    dependency_type: EpicDependencyType = 'blocks'
  ): Promise<EpicDependency> {
    // Check for circular dependency
    if (await this.wouldCreateCircularDependency(epic_id, depends_on_epic_id)) {
      throw new Error('This would create a circular dependency');
    }

    const result = await this.fastify.db.query<EpicDependency>(
      `INSERT INTO epic_dependencies (epic_id, depends_on_epic_id, dependency_type)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [epic_id, depends_on_epic_id, dependency_type]
    );

    if (result.rows.length === 0) {
      throw new Error('Dependency already exists');
    }

    return result.rows[0]!;
  }

  async removeDependency(epic_id: string, depends_on_epic_id: string): Promise<boolean> {
    const result = await this.fastify.db.query(
      `DELETE FROM epic_dependencies WHERE epic_id = $1 AND depends_on_epic_id = $2`,
      [epic_id, depends_on_epic_id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async wouldCreateCircularDependency(
    epic_id: string,
    depends_on_epic_id: string
  ): Promise<boolean> {
    // Use recursive CTE to check for cycles
    const result = await this.fastify.db.query<{ found: boolean }>(
      `WITH RECURSIVE dep_chain AS (
        SELECT depends_on_epic_id as epic_id
        FROM epic_dependencies
        WHERE epic_id = $2

        UNION

        SELECT ed.depends_on_epic_id
        FROM epic_dependencies ed
        INNER JOIN dep_chain dc ON dc.epic_id = ed.epic_id
      )
      SELECT EXISTS(SELECT 1 FROM dep_chain WHERE epic_id = $1) as found`,
      [epic_id, depends_on_epic_id]
    );

    return result.rows[0]?.found ?? false;
  }

  // ============================================
  // BULK OPERATIONS
  // ============================================

  async createEpicsForProject(
    project_id: string,
    workspace_id: string,
    epics: Array<{ name: string; description?: string; estimated_weeks?: number }>
  ): Promise<Epic[]> {
    const created: Epic[] = [];

    for (const epicInput of epics) {
      const epic = await this.createEpic({
        project_id,
        workspace_id,
        name: epicInput.name,
        description: epicInput.description,
        estimated_weeks: epicInput.estimated_weeks,
      });
      created.push(epic);
    }

    return created;
  }

  async createStoriesForEpic(
    epic_id: string,
    workspace_id: string,
    stories: CreateStoryInput[]
  ): Promise<void> {
    // Update epic status
    await this.updateEpic(epic_id, workspace_id, { status: 'ready' });

    // Create tasks linked to epic
    for (const story of stories) {
      // Generate task key
      const key = await generateKey(this.fastify.db, workspace_id, 'task');

      await this.fastify.db.query(
        `INSERT INTO tasks (workspace_id, epic_id, title, description, estimated_hours, priority, status, key)
         VALUES ($1, $2, $3, $4, $5, $6, 'BACKLOG', $7)`,
        [
          workspace_id,
          epic_id,
          story.title,
          story.description,
          story.estimated_hours ?? 0,
          story.priority ?? 'MED',
          key,
        ]
      );
    }
  }

  async getStoriesForEpic(epic_id: string, workspace_id: string): Promise<unknown[]> {
    const result = await this.fastify.db.query(
      `SELECT * FROM tasks WHERE epic_id = $1 AND workspace_id = $2 ORDER BY created_at`,
      [epic_id, workspace_id]
    );
    return result.rows;
  }
}
