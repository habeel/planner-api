export class WorkspaceService {
    constructor(fastify) {
        this.fastify = fastify;
    }
    async create(input) {
        const client = await this.fastify.db.connect();
        try {
            await client.query('BEGIN');
            const workspaceResult = await client.query(`INSERT INTO workspaces (name, owner_id, organization_id)
         VALUES ($1, $2, $3)
         RETURNING *`, [input.name, input.owner_id, input.organization_id]);
            const workspace = workspaceResult.rows[0];
            // Add owner as admin
            await client.query(`INSERT INTO user_workspace_roles (workspace_id, user_id, role)
         VALUES ($1, $2, 'ADMIN')`, [workspace.id, input.owner_id]);
            await client.query('COMMIT');
            return workspace;
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
    }
    /**
     * @deprecated Use createWithOrg instead. This is kept for backward compatibility.
     */
    async createLegacy(name, ownerId) {
        const client = await this.fastify.db.connect();
        try {
            await client.query('BEGIN');
            const workspaceResult = await client.query(`INSERT INTO workspaces (name, owner_id)
         VALUES ($1, $2)
         RETURNING *`, [name, ownerId]);
            const workspace = workspaceResult.rows[0];
            // Add owner as admin
            await client.query(`INSERT INTO user_workspace_roles (workspace_id, user_id, role)
         VALUES ($1, $2, 'ADMIN')`, [workspace.id, ownerId]);
            await client.query('COMMIT');
            return workspace;
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
    }
    async getById(id) {
        const result = await this.fastify.db.query(`SELECT * FROM workspaces WHERE id = $1`, [id]);
        return result.rows[0] || null;
    }
    async getUserWorkspaces(userId) {
        const result = await this.fastify.db.query(`SELECT w.* FROM workspaces w
       JOIN user_workspace_roles uwr ON uwr.workspace_id = w.id
       WHERE uwr.user_id = $1`, [userId]);
        return result.rows;
    }
    async getUserWorkspacesInOrg(userId, organizationId) {
        const result = await this.fastify.db.query(`SELECT w.* FROM workspaces w
       JOIN user_workspace_roles uwr ON uwr.workspace_id = w.id
       WHERE uwr.user_id = $1 AND w.organization_id = $2`, [userId, organizationId]);
        return result.rows;
    }
    async getByOrganization(organizationId) {
        const result = await this.fastify.db.query(`SELECT * FROM workspaces WHERE organization_id = $1 ORDER BY name`, [organizationId]);
        return result.rows;
    }
    async getUserRole(workspaceId, userId) {
        const result = await this.fastify.db.query(`SELECT role FROM user_workspace_roles
       WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, userId]);
        return result.rows[0]?.role || null;
    }
    async addMember(workspaceId, userId, role) {
        const result = await this.fastify.db.query(`INSERT INTO user_workspace_roles (workspace_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = $3
       RETURNING *`, [workspaceId, userId, role]);
        return result.rows[0];
    }
    async removeMember(workspaceId, userId) {
        const result = await this.fastify.db.query(`DELETE FROM user_workspace_roles
       WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, userId]);
        return (result.rowCount ?? 0) > 0;
    }
    async updateMemberRole(workspaceId, userId, role) {
        const result = await this.fastify.db.query(`UPDATE user_workspace_roles SET role = $3
       WHERE workspace_id = $1 AND user_id = $2
       RETURNING *`, [workspaceId, userId, role]);
        return result.rows[0] || null;
    }
    async getMembers(workspaceId) {
        const result = await this.fastify.db.query(`SELECT u.id as user_id, u.email, u.name, uwr.role
       FROM user_workspace_roles uwr
       JOIN users u ON u.id = uwr.user_id
       WHERE uwr.workspace_id = $1`, [workspaceId]);
        return result.rows;
    }
}
//# sourceMappingURL=workspaceService.js.map