import type { FastifyInstance } from 'fastify';
import type { User, UserPublic, UserWorkspaceRole, Workspace } from '../types/index.js';

export interface UserWithRoles extends UserPublic {
  workspaces: Array<{
    workspace: Workspace;
    role: string;
  }>;
}

export class UserService {
  constructor(private fastify: FastifyInstance) {}

  async getById(id: string): Promise<UserPublic | null> {
    const result = await this.fastify.db.query<User>(
      `SELECT id, email, name, capacity_week_hours, timezone, is_active, created_at, updated_at
       FROM users WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  async getByEmail(email: string): Promise<UserPublic | null> {
    const result = await this.fastify.db.query<User>(
      `SELECT id, email, name, capacity_week_hours, timezone, is_active, created_at, updated_at
       FROM users WHERE email = $1`,
      [email]
    );
    return result.rows[0] || null;
  }

  async getUserWithRoles(id: string): Promise<UserWithRoles | null> {
    const userResult = await this.fastify.db.query<User>(
      `SELECT id, email, name, capacity_week_hours, timezone, is_active, created_at, updated_at
       FROM users WHERE id = $1`,
      [id]
    );

    const user = userResult.rows[0];
    if (!user) return null;

    interface WorkspaceRoleRow {
      role: string;
      workspace_id: string;
      workspace_name: string;
      owner_id: string | null;
      organization_id: string | null;
      workspace_created_at: Date;
    }

    const rolesResult = await this.fastify.db.query<WorkspaceRoleRow>(
      `SELECT uwr.role, w.id as workspace_id, w.name as workspace_name, w.owner_id, w.organization_id, w.created_at as workspace_created_at
       FROM user_workspace_roles uwr
       JOIN workspaces w ON w.id = uwr.workspace_id
       WHERE uwr.user_id = $1`,
      [id]
    );

    const workspaces = rolesResult.rows.map((row) => ({
      workspace: {
        id: row.workspace_id,
        name: row.workspace_name,
        owner_id: row.owner_id,
        organization_id: row.organization_id,
        created_at: row.workspace_created_at,
      },
      role: row.role,
    }));

    return {
      ...user,
      workspaces,
    };
  }

  async updateUser(
    id: string,
    data: Partial<Pick<User, 'name' | 'capacity_week_hours' | 'timezone'>>
  ): Promise<UserPublic | null> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.capacity_week_hours !== undefined) {
      updates.push(`capacity_week_hours = $${paramIndex++}`);
      values.push(data.capacity_week_hours);
    }
    if (data.timezone !== undefined) {
      updates.push(`timezone = $${paramIndex++}`);
      values.push(data.timezone);
    }

    if (updates.length === 0) return this.getById(id);

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await this.fastify.db.query<User>(
      `UPDATE users SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, email, name, capacity_week_hours, timezone, is_active, created_at, updated_at`,
      values
    );

    return result.rows[0] || null;
  }

  async getWorkspaceUsers(workspaceId: string): Promise<UserPublic[]> {
    const result = await this.fastify.db.query<User>(
      `SELECT u.id, u.email, u.name, u.capacity_week_hours, u.timezone, u.is_active, u.created_at, u.updated_at
       FROM users u
       JOIN user_workspace_roles uwr ON uwr.user_id = u.id
       WHERE uwr.workspace_id = $1 AND u.is_active = true`,
      [workspaceId]
    );
    return result.rows;
  }
}
