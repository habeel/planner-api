import type { FastifyInstance } from 'fastify';
import type { Workspace, UserWorkspaceRole, WorkspaceRole } from '../types/index.js';

export interface CreateWorkspaceInput {
  name: string;
  owner_id: string;
  organization_id: string;
}

export class WorkspaceService {
  constructor(private fastify: FastifyInstance) {}

  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    const client = await this.fastify.db.connect();

    try {
      await client.query('BEGIN');

      const workspaceResult = await client.query<Workspace>(
        `INSERT INTO workspaces (name, owner_id, organization_id)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [input.name, input.owner_id, input.organization_id]
      );

      const workspace = workspaceResult.rows[0]!;

      // Add owner as admin
      await client.query(
        `INSERT INTO user_workspace_roles (workspace_id, user_id, role)
         VALUES ($1, $2, 'ADMIN')`,
        [workspace.id, input.owner_id]
      );

      await client.query('COMMIT');

      return workspace;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * @deprecated Use createWithOrg instead. This is kept for backward compatibility.
   */
  async createLegacy(name: string, ownerId: string): Promise<Workspace> {
    const client = await this.fastify.db.connect();

    try {
      await client.query('BEGIN');

      const workspaceResult = await client.query<Workspace>(
        `INSERT INTO workspaces (name, owner_id)
         VALUES ($1, $2)
         RETURNING *`,
        [name, ownerId]
      );

      const workspace = workspaceResult.rows[0]!;

      // Add owner as admin
      await client.query(
        `INSERT INTO user_workspace_roles (workspace_id, user_id, role)
         VALUES ($1, $2, 'ADMIN')`,
        [workspace.id, ownerId]
      );

      await client.query('COMMIT');

      return workspace;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getById(id: string): Promise<Workspace | null> {
    const result = await this.fastify.db.query<Workspace>(
      `SELECT * FROM workspaces WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  async getUserWorkspaces(userId: string): Promise<Workspace[]> {
    const result = await this.fastify.db.query<Workspace>(
      `SELECT w.* FROM workspaces w
       JOIN user_workspace_roles uwr ON uwr.workspace_id = w.id
       WHERE uwr.user_id = $1`,
      [userId]
    );
    return result.rows;
  }

  async getUserWorkspacesInOrg(userId: string, organizationId: string): Promise<Workspace[]> {
    const result = await this.fastify.db.query<Workspace>(
      `SELECT w.* FROM workspaces w
       JOIN user_workspace_roles uwr ON uwr.workspace_id = w.id
       WHERE uwr.user_id = $1 AND w.organization_id = $2`,
      [userId, organizationId]
    );
    return result.rows;
  }

  async getByOrganization(organizationId: string): Promise<Workspace[]> {
    const result = await this.fastify.db.query<Workspace>(
      `SELECT * FROM workspaces WHERE organization_id = $1 ORDER BY name`,
      [organizationId]
    );
    return result.rows;
  }

  async getUserRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
    const result = await this.fastify.db.query<UserWorkspaceRole>(
      `SELECT role FROM user_workspace_roles
       WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId]
    );
    return (result.rows[0]?.role as WorkspaceRole) || null;
  }

  async addMember(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole
  ): Promise<UserWorkspaceRole> {
    const result = await this.fastify.db.query<UserWorkspaceRole>(
      `INSERT INTO user_workspace_roles (workspace_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = $3
       RETURNING *`,
      [workspaceId, userId, role]
    );
    return result.rows[0]!;
  }

  async removeMember(workspaceId: string, userId: string): Promise<boolean> {
    const result = await this.fastify.db.query(
      `DELETE FROM user_workspace_roles
       WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async updateMemberRole(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole
  ): Promise<UserWorkspaceRole | null> {
    const result = await this.fastify.db.query<UserWorkspaceRole>(
      `UPDATE user_workspace_roles SET role = $3
       WHERE workspace_id = $1 AND user_id = $2
       RETURNING *`,
      [workspaceId, userId, role]
    );
    return result.rows[0] || null;
  }

  async getMembers(
    workspaceId: string
  ): Promise<Array<{ user_id: string; email: string; name: string | null; role: WorkspaceRole }>> {
    const result = await this.fastify.db.query(
      `SELECT u.id as user_id, u.email, u.name, uwr.role
       FROM user_workspace_roles uwr
       JOIN users u ON u.id = uwr.user_id
       WHERE uwr.workspace_id = $1`,
      [workspaceId]
    );
    return result.rows as Array<{ user_id: string; email: string; name: string | null; role: WorkspaceRole }>;
  }
}
