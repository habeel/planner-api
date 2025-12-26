import type { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import type {
  Invitation,
  OrganizationRole,
  WorkspaceRole,
} from '../types/index.js';

export interface CreateInvitationInput {
  organization_id: string;
  workspace_id?: string;
  email: string;
  role: OrganizationRole;
  workspace_role?: WorkspaceRole;
  invited_by: string;
}

export interface InvitationWithOrg extends Invitation {
  organization_name: string;
  organization_slug: string;
  workspace_name?: string;
  inviter_name?: string;
  inviter_email?: string;
}

const INVITATION_EXPIRY_DAYS = 7;

export class InvitationService {
  constructor(private fastify: FastifyInstance) {}

  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async create(input: CreateInvitationInput): Promise<Invitation> {
    const token = this.generateToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

    const result = await this.fastify.db.query<Invitation>(
      `INSERT INTO invitations (
        organization_id, workspace_id, email, role, workspace_role, token, invited_by, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        input.organization_id,
        input.workspace_id || null,
        input.email.toLowerCase(),
        input.role,
        input.workspace_role || null,
        token,
        input.invited_by,
        expiresAt,
      ]
    );

    return result.rows[0]!;
  }

  async getByToken(token: string): Promise<InvitationWithOrg | null> {
    const result = await this.fastify.db.query<InvitationWithOrg>(
      `SELECT
        i.*,
        o.name as organization_name,
        o.slug as organization_slug,
        w.name as workspace_name,
        u.name as inviter_name,
        u.email as inviter_email
      FROM invitations i
      JOIN organizations o ON i.organization_id = o.id
      LEFT JOIN workspaces w ON i.workspace_id = w.id
      LEFT JOIN users u ON i.invited_by = u.id
      WHERE i.token = $1`,
      [token]
    );
    return result.rows[0] || null;
  }

  async getById(id: string): Promise<Invitation | null> {
    const result = await this.fastify.db.query<Invitation>(
      `SELECT * FROM invitations WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  async getByEmail(email: string): Promise<Invitation[]> {
    const result = await this.fastify.db.query<Invitation>(
      `SELECT * FROM invitations
       WHERE email = $1 AND accepted_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [email.toLowerCase()]
    );
    return result.rows;
  }

  async getByOrganization(orgId: string): Promise<InvitationWithOrg[]> {
    const result = await this.fastify.db.query<InvitationWithOrg>(
      `SELECT
        i.*,
        o.name as organization_name,
        o.slug as organization_slug,
        w.name as workspace_name,
        u.name as inviter_name,
        u.email as inviter_email
      FROM invitations i
      JOIN organizations o ON i.organization_id = o.id
      LEFT JOIN workspaces w ON i.workspace_id = w.id
      LEFT JOIN users u ON i.invited_by = u.id
      WHERE i.organization_id = $1
      ORDER BY i.created_at DESC`,
      [orgId]
    );
    return result.rows;
  }

  async getPendingByOrganization(orgId: string): Promise<InvitationWithOrg[]> {
    const result = await this.fastify.db.query<InvitationWithOrg>(
      `SELECT
        i.*,
        o.name as organization_name,
        o.slug as organization_slug,
        w.name as workspace_name,
        u.name as inviter_name,
        u.email as inviter_email
      FROM invitations i
      JOIN organizations o ON i.organization_id = o.id
      LEFT JOIN workspaces w ON i.workspace_id = w.id
      LEFT JOIN users u ON i.invited_by = u.id
      WHERE i.organization_id = $1
        AND i.accepted_at IS NULL
        AND i.expires_at > NOW()
      ORDER BY i.created_at DESC`,
      [orgId]
    );
    return result.rows;
  }

  async accept(token: string, userId: string): Promise<{ success: boolean; error?: string }> {
    const invitation = await this.getByToken(token);

    if (!invitation) {
      return { success: false, error: 'Invitation not found' };
    }

    if (invitation.accepted_at) {
      return { success: false, error: 'Invitation has already been accepted' };
    }

    if (new Date(invitation.expires_at) < new Date()) {
      return { success: false, error: 'Invitation has expired' };
    }

    // Start a transaction
    const client = await this.fastify.db.connect();

    try {
      await client.query('BEGIN');

      // Mark invitation as accepted
      await client.query(
        `UPDATE invitations SET accepted_at = NOW() WHERE id = $1`,
        [invitation.id]
      );

      // Add user to organization
      await client.query(
        `INSERT INTO user_organization_roles (organization_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (organization_id, user_id) DO UPDATE SET role = $3`,
        [invitation.organization_id, userId, invitation.role]
      );

      // If workspace_id is specified, add user to that workspace
      if (invitation.workspace_id && invitation.workspace_role) {
        await client.query(
          `INSERT INTO user_workspace_roles (workspace_id, user_id, role)
           VALUES ($1, $2, $3)
           ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = $3`,
          [invitation.workspace_id, userId, invitation.workspace_role]
        );
      } else {
        // No specific workspace specified - add user to all workspaces in the org
        // with a default role of DEVELOPER
        await client.query(
          `INSERT INTO user_workspace_roles (workspace_id, user_id, role)
           SELECT w.id, $2, 'DEVELOPER'
           FROM workspaces w
           WHERE w.organization_id = $1
           ON CONFLICT (workspace_id, user_id) DO NOTHING`,
          [invitation.organization_id, userId]
        );
      }

      await client.query('COMMIT');
      return { success: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async revoke(id: string): Promise<boolean> {
    const result = await this.fastify.db.query(
      `DELETE FROM invitations WHERE id = $1 AND accepted_at IS NULL`,
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async resend(id: string): Promise<Invitation | null> {
    const token = this.generateToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

    const result = await this.fastify.db.query<Invitation>(
      `UPDATE invitations
       SET token = $2, expires_at = $3
       WHERE id = $1 AND accepted_at IS NULL
       RETURNING *`,
      [id, token, expiresAt]
    );

    return result.rows[0] || null;
  }

  async isEmailInvited(orgId: string, email: string): Promise<boolean> {
    const result = await this.fastify.db.query(
      `SELECT id FROM invitations
       WHERE organization_id = $1
         AND email = $2
         AND accepted_at IS NULL
         AND expires_at > NOW()`,
      [orgId, email.toLowerCase()]
    );
    return result.rows.length > 0;
  }

  async cleanupExpired(): Promise<number> {
    // Delete invitations that expired more than 30 days ago
    const result = await this.fastify.db.query(
      `DELETE FROM invitations
       WHERE accepted_at IS NULL
         AND expires_at < NOW() - INTERVAL '30 days'`
    );
    return result.rowCount ?? 0;
  }
}
