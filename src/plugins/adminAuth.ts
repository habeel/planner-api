import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AdminService, type PlatformAdmin, type AdminRole } from '../services/adminService.js';

declare module 'fastify' {
  interface FastifyInstance {
    adminService: AdminService;
    authenticateAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdminRole: (roles: AdminRole[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    admin?: PlatformAdmin;
    adminToken?: string;
  }
}

async function adminAuthPlugin(fastify: FastifyInstance) {
  // Create admin service instance
  const adminService = new AdminService(fastify);
  fastify.decorate('adminService', adminService);

  // Authenticate admin middleware
  fastify.decorate('authenticateAdmin', async function (request: FastifyRequest, reply: FastifyReply) {
    const token = request.headers['x-admin-token'] as string;

    if (!token) {
      return reply.status(401).send({ error: 'ADMIN_AUTH_REQUIRED', message: 'Admin authentication required' });
    }

    try {
      const admin = await adminService.validateSession(token);

      if (!admin) {
        return reply.status(401).send({ error: 'INVALID_ADMIN_SESSION', message: 'Invalid or expired admin session' });
      }

      request.admin = admin;
      request.adminToken = token;
    } catch (err) {
      fastify.log.error(err, 'Admin auth error');
      return reply.status(401).send({ error: 'AUTH_ERROR', message: 'Authentication failed' });
    }
  });

  // Role-based access control middleware factory
  fastify.decorate('requireAdminRole', function (roles: AdminRole[]) {
    return async function (request: FastifyRequest, reply: FastifyReply) {
      if (!request.admin) {
        return reply.status(401).send({ error: 'ADMIN_AUTH_REQUIRED', message: 'Admin authentication required' });
      }

      if (!roles.includes(request.admin.role)) {
        return reply.status(403).send({
          error: 'INSUFFICIENT_ADMIN_ROLE',
          message: `This action requires one of the following roles: ${roles.join(', ')}`,
        });
      }
    };
  });
}

export default fp(adminAuthPlugin, {
  name: 'adminAuth',
  dependencies: ['postgres'],
});
