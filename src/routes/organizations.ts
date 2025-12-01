import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { OrganizationService } from '../services/organizationService.js';
import type { OrganizationRole } from '../types/index.js';

const createOrgSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens').optional(),
  billing_email: z.string().email().optional(),
});

const updateOrgSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens').optional(),
  billing_email: z.string().email().optional(),
});

const addMemberSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
});

const updateMemberRoleSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
});

export default async function organizationRoutes(fastify: FastifyInstance) {
  const orgService = new OrganizationService(fastify);

  // All routes require authentication
  fastify.addHook('onRequest', fastify.authenticate);

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

  // GET /api/organizations - List user's organizations
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user.id;
    const orgs = await orgService.getUserOrganizations(userId);
    return reply.send(orgs);
  });

  // POST /api/organizations - Create new organization
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = createOrgSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid input',
        code: 'INVALID_INPUT',
        details: parseResult.error.flatten(),
      });
    }

    const { name, slug, billing_email } = parseResult.data;
    const userId = request.user.id;

    // Check if user already owns a free organization
    const freeOrgCount = await orgService.countUserOwnedFreeOrganizations(userId);
    if (freeOrgCount >= 1) {
      return reply.status(403).send({
        error: 'You already have a free organization. Upgrade to a paid plan to create additional organizations.',
        code: 'FREE_ORG_LIMIT',
      });
    }

    // Generate slug if not provided
    const finalSlug = slug || orgService.generateSlug(name);

    // Check slug availability
    const slugAvailable = await orgService.isSlugAvailable(finalSlug);
    if (!slugAvailable) {
      return reply.status(409).send({
        error: 'Organization slug is already taken',
        code: 'SLUG_TAKEN',
      });
    }

    const org = await orgService.create({
      name,
      slug: finalSlug,
      owner_id: userId,
      billing_email,
    });

    return reply.status(201).send(org);
  });

  // GET /api/organizations/:id - Get organization by ID
  fastify.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const userId = request.user.id;

    const { allowed } = await checkOrgAccess(userId, id);
    if (!allowed) {
      return reply.status(403).send({
        error: 'You do not have access to this organization',
        code: 'FORBIDDEN',
      });
    }

    const org = await orgService.getById(id);
    if (!org) {
      return reply.status(404).send({
        error: 'Organization not found',
        code: 'NOT_FOUND',
      });
    }

    return reply.send(org);
  });

  // GET /api/organizations/slug/:slug - Get organization by slug
  fastify.get('/slug/:slug', async (request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
    const { slug } = request.params;
    const userId = request.user.id;

    const org = await orgService.getBySlug(slug);
    if (!org) {
      return reply.status(404).send({
        error: 'Organization not found',
        code: 'NOT_FOUND',
      });
    }

    const { allowed } = await checkOrgAccess(userId, org.id);
    if (!allowed) {
      return reply.status(403).send({
        error: 'You do not have access to this organization',
        code: 'FORBIDDEN',
      });
    }

    return reply.send(org);
  });

  // PATCH /api/organizations/:id - Update organization
  fastify.patch('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const userId = request.user.id;

    const { allowed, role } = await checkOrgAccess(userId, id, ['OWNER', 'ADMIN']);
    if (!allowed) {
      return reply.status(403).send({
        error: role ? 'Insufficient permissions' : 'You do not have access to this organization',
        code: 'FORBIDDEN',
      });
    }

    const parseResult = updateOrgSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid input',
        code: 'INVALID_INPUT',
        details: parseResult.error.flatten(),
      });
    }

    const { slug } = parseResult.data;

    // Check slug availability if changing it
    if (slug) {
      const slugAvailable = await orgService.isSlugAvailable(slug, id);
      if (!slugAvailable) {
        return reply.status(409).send({
          error: 'Organization slug is already taken',
          code: 'SLUG_TAKEN',
        });
      }
    }

    const org = await orgService.update(id, parseResult.data);
    if (!org) {
      return reply.status(404).send({
        error: 'Organization not found',
        code: 'NOT_FOUND',
      });
    }

    return reply.send(org);
  });

  // DELETE /api/organizations/:id - Delete (soft) organization
  fastify.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const userId = request.user.id;

    const { allowed, role } = await checkOrgAccess(userId, id, ['OWNER']);
    if (!allowed) {
      return reply.status(403).send({
        error: role ? 'Only the owner can delete the organization' : 'You do not have access to this organization',
        code: 'FORBIDDEN',
      });
    }

    const deleted = await orgService.delete(id);
    if (!deleted) {
      return reply.status(404).send({
        error: 'Organization not found',
        code: 'NOT_FOUND',
      });
    }

    return reply.send({ success: true });
  });

  // GET /api/organizations/:id/members - List members
  fastify.get('/:id/members', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const userId = request.user.id;

    const { allowed } = await checkOrgAccess(userId, id);
    if (!allowed) {
      return reply.status(403).send({
        error: 'You do not have access to this organization',
        code: 'FORBIDDEN',
      });
    }

    const members = await orgService.getMembers(id);
    return reply.send(members);
  });

  // POST /api/organizations/:id/members - Add member (direct add, not invitation)
  fastify.post('/:id/members', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const userId = request.user.id;

    const { allowed, role } = await checkOrgAccess(userId, id, ['OWNER', 'ADMIN']);
    if (!allowed) {
      return reply.status(403).send({
        error: role ? 'Insufficient permissions' : 'You do not have access to this organization',
        code: 'FORBIDDEN',
      });
    }

    const parseResult = addMemberSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid input',
        code: 'INVALID_INPUT',
        details: parseResult.error.flatten(),
      });
    }

    const { user_id, role: memberRole } = parseResult.data;

    // Check plan limits
    const limitCheck = await orgService.checkLimit(id, 'max_users');
    if (!limitCheck.allowed) {
      return reply.status(403).send({
        error: `User limit reached (${limitCheck.current}/${limitCheck.max}). Upgrade your plan to add more users.`,
        code: 'LIMIT_EXCEEDED',
      });
    }

    // Only owner can add another owner
    if (memberRole === 'OWNER' && role !== 'OWNER') {
      return reply.status(403).send({
        error: 'Only the owner can add another owner',
        code: 'FORBIDDEN',
      });
    }

    await orgService.addMember(id, user_id, memberRole);
    return reply.status(201).send({ success: true });
  });

  // PATCH /api/organizations/:id/members/:userId - Update member role
  fastify.patch('/:id/members/:userId', async (request: FastifyRequest<{ Params: { id: string; userId: string } }>, reply: FastifyReply) => {
    const { id, userId: targetUserId } = request.params;
    const userId = request.user.id;

    const { allowed, role } = await checkOrgAccess(userId, id, ['OWNER', 'ADMIN']);
    if (!allowed) {
      return reply.status(403).send({
        error: role ? 'Insufficient permissions' : 'You do not have access to this organization',
        code: 'FORBIDDEN',
      });
    }

    const parseResult = updateMemberRoleSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid input',
        code: 'INVALID_INPUT',
        details: parseResult.error.flatten(),
      });
    }

    const { role: newRole } = parseResult.data;

    // Only owner can set/remove owner role
    if (newRole === 'OWNER' && role !== 'OWNER') {
      return reply.status(403).send({
        error: 'Only the owner can assign the owner role',
        code: 'FORBIDDEN',
      });
    }

    // Check if trying to demote an owner
    const targetRole = await orgService.getUserRole(id, targetUserId);
    if (targetRole === 'OWNER' && role !== 'OWNER') {
      return reply.status(403).send({
        error: 'Only an owner can demote another owner',
        code: 'FORBIDDEN',
      });
    }

    // Can't demote yourself if you're the only owner
    if (targetUserId === userId && targetRole === 'OWNER' && newRole !== 'OWNER') {
      const members = await orgService.getMembers(id);
      const ownerCount = members.filter(m => m.role === 'OWNER').length;
      if (ownerCount <= 1) {
        return reply.status(400).send({
          error: 'Cannot demote the only owner. Transfer ownership first.',
          code: 'INVALID_OPERATION',
        });
      }
    }

    const updated = await orgService.updateMemberRole(id, targetUserId, newRole);
    if (!updated) {
      return reply.status(404).send({
        error: 'Member not found',
        code: 'NOT_FOUND',
      });
    }

    return reply.send({ success: true });
  });

  // DELETE /api/organizations/:id/members/:userId - Remove member
  fastify.delete('/:id/members/:userId', async (request: FastifyRequest<{ Params: { id: string; userId: string } }>, reply: FastifyReply) => {
    const { id, userId: targetUserId } = request.params;
    const userId = request.user.id;

    // User can remove themselves
    if (targetUserId !== userId) {
      const { allowed, role } = await checkOrgAccess(userId, id, ['OWNER', 'ADMIN']);
      if (!allowed) {
        return reply.status(403).send({
          error: role ? 'Insufficient permissions' : 'You do not have access to this organization',
          code: 'FORBIDDEN',
        });
      }

      // Check if trying to remove an owner
      const targetRole = await orgService.getUserRole(id, targetUserId);
      if (targetRole === 'OWNER' && role !== 'OWNER') {
        return reply.status(403).send({
          error: 'Only an owner can remove another owner',
          code: 'FORBIDDEN',
        });
      }
    }

    // Can't remove the only owner
    const targetRole = await orgService.getUserRole(id, targetUserId);
    if (targetRole === 'OWNER') {
      const members = await orgService.getMembers(id);
      const ownerCount = members.filter(m => m.role === 'OWNER').length;
      if (ownerCount <= 1) {
        return reply.status(400).send({
          error: 'Cannot remove the only owner. Transfer ownership first.',
          code: 'INVALID_OPERATION',
        });
      }
    }

    const removed = await orgService.removeMember(id, targetUserId);
    if (!removed) {
      return reply.status(404).send({
        error: 'Member not found',
        code: 'NOT_FOUND',
      });
    }

    return reply.send({ success: true });
  });

  // GET /api/organizations/:id/usage - Get usage stats
  fastify.get('/:id/usage', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const userId = request.user.id;

    const { allowed } = await checkOrgAccess(userId, id);
    if (!allowed) {
      return reply.status(403).send({
        error: 'You do not have access to this organization',
        code: 'FORBIDDEN',
      });
    }

    const org = await orgService.getById(id);
    if (!org) {
      return reply.status(404).send({
        error: 'Organization not found',
        code: 'NOT_FOUND',
      });
    }

    const usage = await orgService.getUsage(id);

    return reply.send({
      usage,
      limits: org.plan_limits,
      plan: org.plan,
    });
  });

  // GET /api/organizations/check-slug/:slug - Check if slug is available
  fastify.get('/check-slug/:slug', async (request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
    const { slug } = request.params;
    const available = await orgService.isSlugAvailable(slug);
    return reply.send({ available });
  });
}
