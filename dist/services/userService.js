export class UserService {
    constructor(fastify) {
        this.fastify = fastify;
    }
    async getById(id) {
        const result = await this.fastify.db.query(`SELECT id, email, name, capacity_week_hours, timezone, is_active, created_at, updated_at
       FROM users WHERE id = $1`, [id]);
        return result.rows[0] || null;
    }
    async getByEmail(email) {
        const result = await this.fastify.db.query(`SELECT id, email, name, capacity_week_hours, timezone, is_active, created_at, updated_at
       FROM users WHERE email = $1`, [email]);
        return result.rows[0] || null;
    }
    async getUserWithRoles(id) {
        const userResult = await this.fastify.db.query(`SELECT id, email, name, capacity_week_hours, timezone, is_active, created_at, updated_at
       FROM users WHERE id = $1`, [id]);
        const user = userResult.rows[0];
        if (!user)
            return null;
        const rolesResult = await this.fastify.db.query(`SELECT uwr.role, w.id as workspace_id, w.name as workspace_name, w.owner_id, w.organization_id, w.created_at as workspace_created_at
       FROM user_workspace_roles uwr
       JOIN workspaces w ON w.id = uwr.workspace_id
       WHERE uwr.user_id = $1`, [id]);
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
    async updateUser(id, data) {
        const updates = [];
        const values = [];
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
        if (updates.length === 0)
            return this.getById(id);
        updates.push(`updated_at = NOW()`);
        values.push(id);
        const result = await this.fastify.db.query(`UPDATE users SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, email, name, capacity_week_hours, timezone, is_active, created_at, updated_at`, values);
        return result.rows[0] || null;
    }
    async getWorkspaceUsers(workspaceId) {
        const result = await this.fastify.db.query(`SELECT u.id, u.email, u.name, u.capacity_week_hours, u.timezone, u.is_active, u.created_at, u.updated_at
       FROM users u
       JOIN user_workspace_roles uwr ON uwr.user_id = u.id
       WHERE uwr.workspace_id = $1 AND u.is_active = true`, [workspaceId]);
        return result.rows;
    }
    /**
     * Delete a user account and all associated data.
     * For GDPR compliance, this performs a hard delete of user data.
     */
    async deleteAccount(userId) {
        const client = await this.fastify.db.connect();
        try {
            await client.query('BEGIN');
            // Check if user owns any organizations
            const ownedOrgsResult = await client.query(`SELECT id, name FROM organizations WHERE owner_id = $1`, [userId]);
            if (ownedOrgsResult.rows.length > 0) {
                // For simplicity, we don't allow deleting accounts that own organizations
                // User must transfer ownership first or delete the organization
                return {
                    success: false,
                    error: 'You must transfer ownership or delete your organizations before deleting your account.',
                };
            }
            // Delete refresh tokens
            await client.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
            // Delete password reset tokens
            await client.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [userId]);
            // Delete email verification tokens
            await client.query(`DELETE FROM email_verification_tokens WHERE user_id = $1`, [userId]);
            // Delete user workspace roles
            await client.query(`DELETE FROM user_workspace_roles WHERE user_id = $1`, [userId]);
            // Delete user organization roles
            await client.query(`DELETE FROM user_organization_roles WHERE user_id = $1`, [userId]);
            // Unassign tasks but keep them (set assigned_to_user_id to null)
            await client.query(`UPDATE tasks SET assigned_to_user_id = NULL WHERE assigned_to_user_id = $1`, [userId]);
            // Delete time entries by user
            await client.query(`DELETE FROM time_entries WHERE user_id = $1`, [userId]);
            // Delete time off records
            await client.query(`DELETE FROM time_off WHERE user_id = $1`, [userId]);
            // Finally, delete the user
            await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
            await client.query('COMMIT');
            return { success: true };
        }
        catch (err) {
            await client.query('ROLLBACK');
            console.error('Error deleting account:', err);
            return { success: false, error: 'Failed to delete account. Please try again.' };
        }
        finally {
            client.release();
        }
    }
}
//# sourceMappingURL=userService.js.map