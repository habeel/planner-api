import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ReportService } from '../services/reportService.js';
import { WorkspaceService } from '../services/workspaceService.js';

const timeReportQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be in YYYY-MM-DD format'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be in YYYY-MM-DD format'),
});

export default async function reportRoutes(fastify: FastifyInstance) {
  const reportService = new ReportService(fastify);
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

  // GET /api/workspaces/:workspaceId/reports/time?from=YYYY-MM-DD&to=YYYY-MM-DD
  fastify.get<{ Params: { workspaceId: string } }>(
    '/:workspaceId/reports/time',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { workspaceId } = request.params;

      // Validate workspaceId is a UUID
      const uuidSchema = z.string().uuid();
      const uuidResult = uuidSchema.safeParse(workspaceId);
      if (!uuidResult.success) {
        return reply.status(400).send({
          error: 'Invalid workspace ID',
          code: 'INVALID_INPUT',
        });
      }

      // Validate query params
      const parseResult = timeReportQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { from, to } = parseResult.data;

      // Validate date range (from should be before or equal to to)
      if (from > to) {
        return reply.status(400).send({
          error: 'Invalid date range: from must be before or equal to to',
          code: 'INVALID_INPUT',
        });
      }

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      const report = await reportService.getTimeReport(workspaceId, from, to);
      return reply.send(report);
    }
  );
}
