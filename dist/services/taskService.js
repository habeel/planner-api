export class TaskService {
    constructor(fastify) {
        this.fastify = fastify;
    }
    async create(input) {
        const result = await this.fastify.db.query(`INSERT INTO tasks (
        workspace_id, title, description, estimated_hours,
        assigned_to_user_id, start_date, due_date, status, priority,
        source, jira_key, github_issue_number, project, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`, [
            input.workspace_id,
            input.title,
            input.description || null,
            input.estimated_hours || 0,
            input.assigned_to_user_id || null,
            input.start_date || null,
            input.due_date || null,
            input.status || 'BACKLOG',
            input.priority || 'MED',
            input.source || 'manual',
            input.jira_key || null,
            input.github_issue_number || null,
            input.project || null,
            input.metadata ? JSON.stringify(input.metadata) : null,
        ]);
        return result.rows[0];
    }
    async getById(id) {
        const result = await this.fastify.db.query(`SELECT * FROM tasks WHERE id = $1`, [id]);
        return result.rows[0] || null;
    }
    async update(id, input, currentTask) {
        // Check if trying to edit external fields on non-manual task
        if (currentTask.source !== 'manual') {
            // Only allow editing certain fields for external tasks
            const allowedFields = ['assigned_to_user_id', 'start_date', 'due_date', 'status', 'priority'];
            const attemptedFields = Object.keys(input);
            const blockedFields = attemptedFields.filter(f => !allowedFields.includes(f));
            if (blockedFields.length > 0) {
                throw new Error(`Cannot edit fields [${blockedFields.join(', ')}] on external task`);
            }
        }
        // Validate estimated_hours when changing status from BACKLOG to PLANNED or beyond
        const newStatus = input.status ?? currentTask.status;
        const newEstimatedHours = input.estimated_hours ?? currentTask.estimated_hours;
        const plannedStatuses = ['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'DONE'];
        if (plannedStatuses.includes(newStatus) && (!newEstimatedHours || newEstimatedHours <= 0)) {
            throw new Error('Estimated hours must be greater than 0 to set status beyond BACKLOG');
        }
        const updates = [];
        const values = [];
        let paramIndex = 1;
        if (input.title !== undefined) {
            updates.push(`title = $${paramIndex++}`);
            values.push(input.title);
        }
        if (input.description !== undefined) {
            updates.push(`description = $${paramIndex++}`);
            values.push(input.description);
        }
        if (input.estimated_hours !== undefined) {
            updates.push(`estimated_hours = $${paramIndex++}`);
            values.push(input.estimated_hours);
        }
        if (input.assigned_to_user_id !== undefined) {
            updates.push(`assigned_to_user_id = $${paramIndex++}`);
            values.push(input.assigned_to_user_id);
        }
        if (input.start_date !== undefined) {
            updates.push(`start_date = $${paramIndex++}`);
            values.push(input.start_date);
        }
        if (input.due_date !== undefined) {
            updates.push(`due_date = $${paramIndex++}`);
            values.push(input.due_date);
        }
        if (input.status !== undefined) {
            updates.push(`status = $${paramIndex++}`);
            values.push(input.status);
        }
        if (input.priority !== undefined) {
            updates.push(`priority = $${paramIndex++}`);
            values.push(input.priority);
        }
        if (input.project !== undefined) {
            updates.push(`project = $${paramIndex++}`);
            values.push(input.project);
        }
        if (input.position_in_backlog !== undefined) {
            updates.push(`position_in_backlog = $${paramIndex++}`);
            values.push(input.position_in_backlog);
        }
        if (updates.length === 0)
            return currentTask;
        updates.push(`updated_at = NOW()`);
        values.push(id);
        const result = await this.fastify.db.query(`UPDATE tasks SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`, values);
        return result.rows[0] || null;
    }
    async delete(id) {
        const result = await this.fastify.db.query(`DELETE FROM tasks WHERE id = $1`, [id]);
        return (result.rowCount ?? 0) > 0;
    }
    async list(filters) {
        const conditions = ['workspace_id = $1'];
        const values = [filters.workspaceId];
        let paramIndex = 2;
        if (filters.assigneeId) {
            conditions.push(`assigned_to_user_id = $${paramIndex++}`);
            values.push(filters.assigneeId);
        }
        if (filters.status) {
            conditions.push(`status = $${paramIndex++}`);
            values.push(filters.status);
        }
        if (filters.from && filters.to) {
            if (filters.includeUnscheduled) {
                conditions.push(`(start_date BETWEEN $${paramIndex} AND $${paramIndex + 1} OR start_date IS NULL)`);
            }
            else {
                conditions.push(`start_date BETWEEN $${paramIndex} AND $${paramIndex + 1}`);
            }
            values.push(filters.from, filters.to);
            paramIndex += 2;
        }
        const result = await this.fastify.db.query(`SELECT * FROM tasks
       WHERE ${conditions.join(' AND ')}
       ORDER BY COALESCE(start_date, '9999-12-31'), priority DESC, created_at`, values);
        return result.rows;
    }
    async getTasksForWeek(workspaceId, weekStart) {
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const weekEndStr = weekEnd.toISOString().split('T')[0];
        const result = await this.fastify.db.query(`SELECT * FROM tasks
       WHERE workspace_id = $1
       AND (start_date BETWEEN $2 AND $3 OR start_date IS NULL)
       ORDER BY COALESCE(start_date, '9999-12-31'), priority DESC`, [workspaceId, weekStart, weekEndStr]);
        return result.rows;
    }
    // Task Dependencies
    async addDependency(taskId, dependsOnTaskId, type = 'FS') {
        const result = await this.fastify.db.query(`INSERT INTO task_dependencies (task_id, depends_on_task_id, type)
       VALUES ($1, $2, $3)
       RETURNING *`, [taskId, dependsOnTaskId, type]);
        return result.rows[0];
    }
    async removeDependency(id) {
        const result = await this.fastify.db.query(`DELETE FROM task_dependencies WHERE id = $1`, [id]);
        return (result.rowCount ?? 0) > 0;
    }
    async getTaskDependencies(taskId) {
        const result = await this.fastify.db.query(`SELECT * FROM task_dependencies WHERE task_id = $1`, [taskId]);
        return result.rows;
    }
    async getTaskDependents(taskId) {
        const result = await this.fastify.db.query(`SELECT * FROM task_dependencies WHERE depends_on_task_id = $1`, [taskId]);
        return result.rows;
    }
    async getDependenciesForTasks(taskIds) {
        if (taskIds.length === 0)
            return [];
        // Create placeholders for first set (task_id IN)
        const placeholders1 = taskIds.map((_, i) => `$${i + 1}`).join(', ');
        // Create placeholders for second set (depends_on_task_id IN), offset by taskIds.length
        const placeholders2 = taskIds.map((_, i) => `$${i + 1 + taskIds.length}`).join(', ');
        const result = await this.fastify.db.query(`SELECT * FROM task_dependencies
       WHERE task_id IN (${placeholders1}) OR depends_on_task_id IN (${placeholders2})`, [...taskIds, ...taskIds]);
        return result.rows;
    }
    /**
     * Check if adding a dependency would create a circular reference.
     * Uses recursive CTE to walk the dependency chain.
     * @param taskId - The task that would depend on dependsOnTaskId
     * @param dependsOnTaskId - The task that taskId would depend on
     * @returns true if adding this dependency would create a cycle
     */
    async hasCircularDependency(taskId, dependsOnTaskId) {
        // Check if dependsOnTaskId (or any of its ancestors) already depends on taskId
        const result = await this.fastify.db.query(`WITH RECURSIVE dep_chain AS (
        -- Start from the task we want to depend on
        SELECT task_id, depends_on_task_id, 1 as depth
        FROM task_dependencies
        WHERE task_id = $2

        UNION ALL

        -- Walk up the dependency chain
        SELECT td.task_id, td.depends_on_task_id, dc.depth + 1
        FROM task_dependencies td
        INNER JOIN dep_chain dc ON td.task_id = dc.depends_on_task_id
        WHERE dc.depth < 100
      )
      SELECT EXISTS(
        SELECT 1 FROM dep_chain WHERE depends_on_task_id = $1
      ) as has_cycle`, [taskId, dependsOnTaskId]);
        return result.rows[0]?.has_cycle ?? false;
    }
}
//# sourceMappingURL=taskService.js.map