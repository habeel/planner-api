import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AdminRole, PlanType } from '../services/adminService.js';

// Validation schemas
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const orgFiltersSchema = z.object({
  search: z.string().optional(),
  plan: z.enum(['free', 'starter', 'pro', 'enterprise']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  sortBy: z.enum(['created_at', 'name', 'users']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

const userFiltersSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  sortBy: z.enum(['created_at', 'email', 'name']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

const auditFiltersSchema = z.object({
  adminId: z.string().uuid().optional(),
  action: z.string().optional(),
  targetType: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const updateOrgSchema = z.object({
  plan: z.enum(['free', 'starter', 'pro', 'enterprise']).optional(),
  is_active: z.boolean().optional(),
});

const updateUserSchema = z.object({
  is_active: z.boolean().optional(),
});

const createAdminSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
  role: z.enum(['OWNER', 'ADMIN', 'SUPPORT']),
});

const updateAdminSchema = z.object({
  name: z.string().optional(),
  role: z.enum(['OWNER', 'ADMIN', 'SUPPORT']).optional(),
  is_active: z.boolean().optional(),
});

function getClientIp(request: { headers: Record<string, string | string[] | undefined>; ip: string }): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    return Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim();
  }
  return request.ip;
}

export async function adminRoutes(fastify: FastifyInstance) {
  // ==================== Auth Routes (No auth required) ====================

  // Login
  fastify.post('/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const ip = getClientIp(request);
    const userAgent = request.headers['user-agent'];

    try {
      const result = await fastify.adminService.login(body.email, body.password, ip, userAgent);

      if (!result) {
        return reply.status(401).send({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
      }

      return { admin: result.admin, token: result.token };
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'ACCOUNT_LOCKED') {
          return reply.status(423).send({ error: 'ACCOUNT_LOCKED', message: 'Account is temporarily locked due to too many failed attempts' });
        }
        if (err.message === 'ACCOUNT_DISABLED') {
          return reply.status(403).send({ error: 'ACCOUNT_DISABLED', message: 'This admin account has been disabled' });
        }
      }
      throw err;
    }
  });

  // ==================== Protected Routes ====================

  // Logout
  fastify.post('/logout', { preHandler: [fastify.authenticateAdmin] }, async (request) => {
    await fastify.adminService.logout(request.adminToken!);
    return { success: true };
  });

  // Get current admin info
  fastify.get('/me', { preHandler: [fastify.authenticateAdmin] }, async (request) => {
    return { admin: request.admin };
  });

  // ==================== Dashboard ====================

  fastify.get('/dashboard/stats', { preHandler: [fastify.authenticateAdmin] }, async () => {
    return fastify.adminService.getDashboardStats();
  });

  fastify.get('/dashboard/growth', { preHandler: [fastify.authenticateAdmin] }, async (request) => {
    const { period = 'month' } = request.query as { period?: 'week' | 'month' | 'year' };
    return fastify.adminService.getGrowthMetrics(period);
  });

  fastify.get('/dashboard/revenue', { preHandler: [fastify.authenticateAdmin] }, async (request) => {
    const { period = 'month' } = request.query as { period?: 'week' | 'month' | 'year' };
    return fastify.adminService.getRevenueMetrics(period);
  });

  // ==================== Organizations ====================

  fastify.get('/organizations', { preHandler: [fastify.authenticateAdmin] }, async (request) => {
    const query = request.query as Record<string, string>;
    const pagination = paginationSchema.parse(query);
    const filters = orgFiltersSchema.parse(query);

    return fastify.adminService.listOrganizations(filters, pagination);
  });

  fastify.get('/organizations/:id', { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const org = await fastify.adminService.getOrganizationDetails(id);

    if (!org) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Organization not found' });
    }

    return org;
  });

  fastify.patch('/organizations/:id', {
    preHandler: [fastify.authenticateAdmin, fastify.requireAdminRole(['OWNER', 'ADMIN'])],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateOrgSchema.parse(request.body);
    const ip = getClientIp(request);

    if (body.plan) {
      await fastify.adminService.updateOrganizationPlan(
        id,
        body.plan as PlanType,
        request.admin!.id,
        request.admin!.email,
        ip
      );
    }

    if (body.is_active !== undefined) {
      await fastify.adminService.toggleOrganizationActive(
        id,
        body.is_active,
        request.admin!.id,
        request.admin!.email,
        ip
      );
    }

    const updated = await fastify.adminService.getOrganizationDetails(id);
    return updated;
  });

  fastify.delete('/organizations/:id', {
    preHandler: [fastify.authenticateAdmin, fastify.requireAdminRole(['OWNER', 'ADMIN'])],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const { hard } = request.query as { hard?: string };
    const ip = getClientIp(request);

    await fastify.adminService.deleteOrganization(
      id,
      hard === 'true',
      request.admin!.id,
      request.admin!.email,
      ip
    );

    return { success: true };
  });

  fastify.post('/organizations/:id/impersonate', {
    preHandler: [fastify.authenticateAdmin, fastify.requireAdminRole(['OWNER', 'ADMIN'])],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ip = getClientIp(request);

    try {
      const result = await fastify.adminService.impersonateOrgOwner(
        id,
        request.admin!.id,
        request.admin!.email,
        ip
      );
      return result;
    } catch (err) {
      if (err instanceof Error && err.message.includes('no owner')) {
        return reply.status(400).send({ error: 'NO_OWNER', message: err.message });
      }
      throw err;
    }
  });

  // ==================== Users ====================

  fastify.get('/users', { preHandler: [fastify.authenticateAdmin] }, async (request) => {
    const query = request.query as Record<string, string>;
    const pagination = paginationSchema.parse(query);
    const filters = userFiltersSchema.parse(query);

    return fastify.adminService.listUsers(filters, pagination);
  });

  fastify.get('/users/:id', { preHandler: [fastify.authenticateAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = await fastify.adminService.getUserDetails(id);

    if (!user) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'User not found' });
    }

    return user;
  });

  fastify.patch('/users/:id', {
    preHandler: [fastify.authenticateAdmin, fastify.requireAdminRole(['OWNER', 'ADMIN', 'SUPPORT'])],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const body = updateUserSchema.parse(request.body);
    const ip = getClientIp(request);

    if (body.is_active !== undefined) {
      await fastify.adminService.toggleUserActive(
        id,
        body.is_active,
        request.admin!.id,
        request.admin!.email,
        ip
      );
    }

    return fastify.adminService.getUserDetails(id);
  });

  fastify.delete('/users/:id', {
    preHandler: [fastify.authenticateAdmin, fastify.requireAdminRole(['OWNER', 'ADMIN'])],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const ip = getClientIp(request);

    await fastify.adminService.deleteUser(
      id,
      request.admin!.id,
      request.admin!.email,
      ip
    );

    return { success: true };
  });

  // ==================== Audit Logs ====================

  fastify.get('/audit-logs', { preHandler: [fastify.authenticateAdmin] }, async (request) => {
    const query = request.query as Record<string, string>;
    const pagination = paginationSchema.parse(query);
    const filters = auditFiltersSchema.parse(query);

    return fastify.adminService.getAuditLogs(filters, pagination);
  });

  // ==================== Admin Management (OWNER only) ====================

  fastify.get('/admins', {
    preHandler: [fastify.authenticateAdmin, fastify.requireAdminRole(['OWNER'])],
  }, async () => {
    return { admins: await fastify.adminService.listAdmins() };
  });

  fastify.post('/admins', {
    preHandler: [fastify.authenticateAdmin, fastify.requireAdminRole(['OWNER'])],
  }, async (request) => {
    const body = createAdminSchema.parse(request.body);
    const ip = getClientIp(request);

    const admin = await fastify.adminService.createAdmin(
      body as { email: string; password: string; name?: string; role: AdminRole },
      request.admin!.id,
      request.admin!.email,
      ip
    );

    return { admin };
  });

  fastify.patch('/admins/:id', {
    preHandler: [fastify.authenticateAdmin, fastify.requireAdminRole(['OWNER'])],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateAdminSchema.parse(request.body);
    const ip = getClientIp(request);

    // Prevent demoting yourself
    if (id === request.admin!.id && body.role && body.role !== 'OWNER') {
      return reply.status(400).send({ error: 'CANNOT_DEMOTE_SELF', message: 'You cannot demote yourself' });
    }

    await fastify.adminService.updateAdmin(
      id,
      body as { name?: string; role?: AdminRole; is_active?: boolean },
      request.admin!.id,
      request.admin!.email,
      ip
    );

    return { success: true };
  });

  fastify.delete('/admins/:id', {
    preHandler: [fastify.authenticateAdmin, fastify.requireAdminRole(['OWNER'])],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ip = getClientIp(request);

    try {
      await fastify.adminService.deleteAdmin(
        id,
        request.admin!.id,
        request.admin!.email,
        ip
      );
      return { success: true };
    } catch (err) {
      if (err instanceof Error && err.message === 'Cannot delete yourself') {
        return reply.status(400).send({ error: 'CANNOT_DELETE_SELF', message: 'You cannot delete yourself' });
      }
      throw err;
    }
  });
}

export default adminRoutes;
