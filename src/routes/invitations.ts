import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { InvitationService } from '../services/invitationService.js';
import { OrganizationService } from '../services/organizationService.js';
import type { OrganizationRole } from '../types/index.js';

const createInvitationSchema = z.object({
  email: z.string().email(),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']).default('MEMBER'),
  workspace_id: z.string().uuid().optional(),
  workspace_role: z.enum(['ADMIN', 'TEAM_LEAD', 'DEVELOPER', 'READ_ONLY']).optional(),
});

export default async function invitationRoutes(fastify: FastifyInstance) {
  const invitationService = new InvitationService(fastify);
  const orgService = new OrganizationService(fastify);

  // Helper to check org access
  async function checkOrgAccess(
    userId: string,
    orgId: string,
    requiredRoles?: OrganizationRole[]
  ): Promise<{ allowed: boolean; role: OrganizationRole | null }> {
    const role = await orgService.getUserRole(orgId, userId);
    if (!role) {
      return { allowed: false, role: null };
    }
    if (requiredRoles && !requiredRoles.includes(role)) {
      return { allowed: false, role };
    }
    return { allowed: true, role };
  }

  // GET /api/invitations/pending - Get pending invitations for current user's email
  fastify.get('/pending', { onRequest: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userEmail = request.user.email;
    const invitations = await invitationService.getByEmail(userEmail);
    return reply.send(invitations);
  });

  // GET /api/invitations/:token - Get invitation by token (public, for invite landing page)
  fastify.get('/:token', async (request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
    const { token } = request.params;
    const invitation = await invitationService.getByToken(token);

    if (!invitation) {
      return reply.status(404).send({
        error: 'Invitation not found',
        code: 'NOT_FOUND',
      });
    }

    if (invitation.accepted_at) {
      return reply.status(400).send({
        error: 'This invitation has already been accepted',
        code: 'ALREADY_ACCEPTED',
      });
    }

    if (new Date(invitation.expires_at) < new Date()) {
      return reply.status(400).send({
        error: 'This invitation has expired',
        code: 'EXPIRED',
      });
    }

    // Return public info only
    return reply.send({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      workspace_role: invitation.workspace_role,
      organization_name: invitation.organization_name,
      organization_slug: invitation.organization_slug,
      workspace_name: invitation.workspace_name,
      inviter_name: invitation.inviter_name,
      expires_at: invitation.expires_at,
    });
  });

  // POST /api/invitations/:token/accept - Accept invitation (authenticated)
  fastify.post<{ Params: { token: string } }>('/:token/accept', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { token } = request.params;
    const userId = request.user.id;
    const userEmail = request.user.email;

    const invitation = await invitationService.getByToken(token);

    if (!invitation) {
      return reply.status(404).send({
        error: 'Invitation not found',
        code: 'NOT_FOUND',
      });
    }

    // Verify the invitation is for this user's email
    if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
      return reply.status(403).send({
        error: 'This invitation is for a different email address',
        code: 'EMAIL_MISMATCH',
      });
    }

    const result = await invitationService.accept(token, userId);

    if (!result.success) {
      return reply.status(400).send({
        error: result.error,
        code: 'ACCEPT_FAILED',
      });
    }

    return reply.send({
      success: true,
      organization_id: invitation.organization_id,
      organization_slug: invitation.organization_slug,
    });
  });

  // Organization-scoped invitation routes (require authentication)
  fastify.register(async function orgInvitationRoutes(fastify: FastifyInstance) {
    fastify.addHook('onRequest', fastify.authenticate);

    // GET /api/invitations/org/:orgId - List organization invitations
    fastify.get('/org/:orgId', async (request: FastifyRequest<{ Params: { orgId: string } }>, reply: FastifyReply) => {
      const { orgId } = request.params;
      const userId = request.user.id;

      const { allowed, role } = await checkOrgAccess(userId, orgId, ['OWNER', 'ADMIN']);
      if (!allowed) {
        return reply.status(403).send({
          error: role ? 'Insufficient permissions' : 'You do not have access to this organization',
          code: 'FORBIDDEN',
        });
      }

      const invitations = await invitationService.getByOrganization(orgId);
      return reply.send(invitations);
    });

    // GET /api/invitations/org/:orgId/pending - List pending invitations
    fastify.get('/org/:orgId/pending', async (request: FastifyRequest<{ Params: { orgId: string } }>, reply: FastifyReply) => {
      const { orgId } = request.params;
      const userId = request.user.id;

      const { allowed, role } = await checkOrgAccess(userId, orgId, ['OWNER', 'ADMIN']);
      if (!allowed) {
        return reply.status(403).send({
          error: role ? 'Insufficient permissions' : 'You do not have access to this organization',
          code: 'FORBIDDEN',
        });
      }

      const invitations = await invitationService.getPendingByOrganization(orgId);
      return reply.send(invitations);
    });

    // POST /api/invitations/org/:orgId - Create invitation
    fastify.post('/org/:orgId', async (request: FastifyRequest<{ Params: { orgId: string } }>, reply: FastifyReply) => {
      const { orgId } = request.params;
      const userId = request.user.id;

      const { allowed, role } = await checkOrgAccess(userId, orgId, ['OWNER', 'ADMIN']);
      if (!allowed) {
        return reply.status(403).send({
          error: role ? 'Insufficient permissions' : 'You do not have access to this organization',
          code: 'FORBIDDEN',
        });
      }

      const parseResult = createInvitationSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { email, role: inviteRole, workspace_id, workspace_role } = parseResult.data;

      // Only owner can invite another owner
      if (inviteRole === 'OWNER' && role !== 'OWNER') {
        return reply.status(403).send({
          error: 'Only the owner can invite another owner',
          code: 'FORBIDDEN',
        });
      }

      // Check plan limits
      const limitCheck = await orgService.checkLimit(orgId, 'max_users');
      if (!limitCheck.allowed) {
        return reply.status(403).send({
          error: `User limit reached (${limitCheck.current}/${limitCheck.max}). Upgrade your plan to add more users.`,
          code: 'LIMIT_EXCEEDED',
        });
      }

      // Check if already invited
      const alreadyInvited = await invitationService.isEmailInvited(orgId, email);
      if (alreadyInvited) {
        return reply.status(409).send({
          error: 'This email already has a pending invitation',
          code: 'ALREADY_INVITED',
        });
      }

      // Check if already a member
      const existingRole = await fastify.db.query(
        `SELECT uor.role FROM user_organization_roles uor
         JOIN users u ON uor.user_id = u.id
         WHERE uor.organization_id = $1 AND LOWER(u.email) = LOWER($2)`,
        [orgId, email]
      );
      if (existingRole.rows.length > 0) {
        return reply.status(409).send({
          error: 'This email is already a member of the organization',
          code: 'ALREADY_MEMBER',
        });
      }

      const invitation = await invitationService.create({
        organization_id: orgId,
        workspace_id,
        email,
        role: inviteRole,
        workspace_role,
        invited_by: userId,
      });

      // Get organization details for email
      const org = await orgService.getById(orgId);

      // Get inviter name
      const inviterResult = await fastify.db.query<{ name: string | null }>(
        `SELECT name FROM users WHERE id = $1`,
        [userId]
      );
      const inviterName = inviterResult.rows[0]?.name || null;

      // Get workspace name if applicable
      let workspaceName: string | null = null;
      if (workspace_id) {
        const workspaceResult = await fastify.db.query<{ name: string }>(
          `SELECT name FROM workspaces WHERE id = $1`,
          [workspace_id]
        );
        workspaceName = workspaceResult.rows[0]?.name || null;
      }

      // Send invitation email
      await fastify.emailService.sendInvitationEmail({
        to: email,
        inviterName,
        organizationName: org?.name || 'Unknown Organization',
        role: inviteRole,
        token: invitation.token,
        workspaceName,
      });

      return reply.status(201).send(invitation);
    });

    // POST /api/invitations/org/:orgId/:invitationId/resend - Resend invitation
    fastify.post('/org/:orgId/:invitationId/resend', async (request: FastifyRequest<{ Params: { orgId: string; invitationId: string } }>, reply: FastifyReply) => {
      const { orgId, invitationId } = request.params;
      const userId = request.user.id;

      const { allowed, role } = await checkOrgAccess(userId, orgId, ['OWNER', 'ADMIN']);
      if (!allowed) {
        return reply.status(403).send({
          error: role ? 'Insufficient permissions' : 'You do not have access to this organization',
          code: 'FORBIDDEN',
        });
      }

      // Verify invitation belongs to this org
      const existing = await invitationService.getById(invitationId);
      if (!existing || existing.organization_id !== orgId) {
        return reply.status(404).send({
          error: 'Invitation not found',
          code: 'NOT_FOUND',
        });
      }

      const invitation = await invitationService.resend(invitationId);
      if (!invitation) {
        return reply.status(400).send({
          error: 'Cannot resend - invitation may have already been accepted',
          code: 'INVALID_OPERATION',
        });
      }

      // Get organization details for email
      const org = await orgService.getById(orgId);

      // Get inviter name (use current user as the resender)
      const inviterResult = await fastify.db.query<{ name: string | null }>(
        `SELECT name FROM users WHERE id = $1`,
        [userId]
      );
      const inviterName = inviterResult.rows[0]?.name || null;

      // Get workspace name if applicable
      let workspaceName: string | null = null;
      if (existing.workspace_id) {
        const workspaceResult = await fastify.db.query<{ name: string }>(
          `SELECT name FROM workspaces WHERE id = $1`,
          [existing.workspace_id]
        );
        workspaceName = workspaceResult.rows[0]?.name || null;
      }

      // Send invitation email
      await fastify.emailService.sendInvitationEmail({
        to: invitation.email,
        inviterName,
        organizationName: org?.name || 'Unknown Organization',
        role: invitation.role,
        token: invitation.token,
        workspaceName,
      });

      return reply.send(invitation);
    });

    // DELETE /api/invitations/org/:orgId/:invitationId - Revoke invitation
    fastify.delete('/org/:orgId/:invitationId', async (request: FastifyRequest<{ Params: { orgId: string; invitationId: string } }>, reply: FastifyReply) => {
      const { orgId, invitationId } = request.params;
      const userId = request.user.id;

      const { allowed, role } = await checkOrgAccess(userId, orgId, ['OWNER', 'ADMIN']);
      if (!allowed) {
        return reply.status(403).send({
          error: role ? 'Insufficient permissions' : 'You do not have access to this organization',
          code: 'FORBIDDEN',
        });
      }

      // Verify invitation belongs to this org
      const existing = await invitationService.getById(invitationId);
      if (!existing || existing.organization_id !== orgId) {
        return reply.status(404).send({
          error: 'Invitation not found',
          code: 'NOT_FOUND',
        });
      }

      const revoked = await invitationService.revoke(invitationId);
      if (!revoked) {
        return reply.status(400).send({
          error: 'Cannot revoke - invitation may have already been accepted',
          code: 'INVALID_OPERATION',
        });
      }

      return reply.send({ success: true });
    });
  });
}
