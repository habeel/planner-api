import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PlanningService } from '../services/planningService.js';
import { WorkspaceService } from '../services/workspaceService.js';

const weekQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const monthQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

const autoScheduleSchema = z.object({
  workspaceId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  strategy: z.enum(['greedy', 'balanced']).optional(),
});

export default async function planningRoutes(fastify: FastifyInstance) {
  const planningService = new PlanningService(fastify);
  const workspaceService = new WorkspaceService(fastify);

  // Helper to check workspace access
  async function checkWorkspaceAccess(
    workspaceId: string,
    userId: string,
    reply: FastifyReply
  ): Promise<boolean> {
    const role = await workspaceService.getUserRole(workspaceId, userId);
    if (!role) {
      reply.status(403).send({ error: 'Access denied', code: 'FORBIDDEN' });
      return false;
    }
    return true;
  }

  // GET /api/planning/week
  fastify.get(
    '/week',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = weekQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId, weekStart } = parseResult.data;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      const planning = await planningService.getWeekPlanning(workspaceId, weekStart);
      return reply.send(planning);
    }
  );

  // GET /api/planning/month
  fastify.get(
    '/month',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = monthQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId, month } = parseResult.data;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      const planning = await planningService.getMonthPlanning(workspaceId, month);
      return reply.send(planning);
    }
  );

  // POST /api/planning/auto-schedule
  fastify.post(
    '/auto-schedule',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = autoScheduleSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId, startDate, endDate, strategy } = parseResult.data;

      // Check for write access (at least DEVELOPER role)
      const role = await workspaceService.getUserRole(workspaceId, request.user.id);
      if (!role || role === 'READ_ONLY') {
        return reply.status(403).send({ error: 'Write access required', code: 'FORBIDDEN' });
      }

      const result = await planningService.autoSchedule(workspaceId, startDate, endDate, strategy);
      return reply.send(result);
    }
  );
}
