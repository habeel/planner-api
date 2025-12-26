import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { TimeOff } from '../types/index.js';

const getTimeOffSchema = z.object({
  workspaceId: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

async function timeOffRoutes(fastify: FastifyInstance) {
  // Get time-off entries for workspace members within a date range
  fastify.get(
    '/time-off',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = getTimeOffSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid query parameters', details: parsed.error.flatten() });
      }

      const { workspaceId, from, to } = parsed.data;

      // Verify user has access to workspace
      const memberCheck = await fastify.db.query(
        `SELECT 1 FROM user_workspace_roles WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, request.user.id]
      );

      if (memberCheck.rows.length === 0) {
        return reply.code(403).send({ error: 'Not a member of this workspace' });
      }

      // Get time-off entries for all workspace members within the date range
      const result = await fastify.db.query<TimeOff>(
        `SELECT t.id, t.user_id, t.date_from, t.date_to, t.type, t.created_at
         FROM time_off t
         JOIN user_workspace_roles uwr ON uwr.user_id = t.user_id
         WHERE uwr.workspace_id = $1
           AND t.date_from <= $3
           AND t.date_to >= $2
         ORDER BY t.user_id, t.date_from`,
        [workspaceId, from, to]
      );

      return reply.send(result.rows);
    }
  );

  // Create time-off entry
  fastify.post(
    '/time-off',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const createSchema = z.object({
        workspace_id: z.string().uuid(),
        user_id: z.string().uuid(),
        date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        type: z.enum(['VACATION', 'HOLIDAY', 'SICK', 'OTHER']),
      });

      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.flatten() });
      }

      const { workspace_id, user_id, date_from, date_to, type } = parsed.data;

      // Verify user has admin or team lead role in workspace
      const roleCheck = await fastify.db.query<{ role: string }>(
        `SELECT role FROM user_workspace_roles WHERE workspace_id = $1 AND user_id = $2`,
        [workspace_id, request.user.id]
      );

      if (roleCheck.rows.length === 0) {
        return reply.code(403).send({ error: 'Not a member of this workspace' });
      }

      const userRole = roleCheck.rows[0].role;
      const canManageTimeOff = userRole === 'ADMIN' || userRole === 'TEAM_LEAD' || request.user.id === user_id;

      if (!canManageTimeOff) {
        return reply.code(403).send({ error: 'Insufficient permissions to manage time-off' });
      }

      // Create time-off entry
      const result = await fastify.db.query<TimeOff>(
        `INSERT INTO time_off (user_id, workspace_id, date_from, date_to, type)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [user_id, workspace_id, date_from, date_to, type]
      );

      return reply.code(201).send(result.rows[0]);
    }
  );

  // Delete time-off entry
  fastify.delete(
    '/time-off/:id',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      // Verify time-off exists and user has permission
      const timeOffResult = await fastify.db.query<TimeOff & { workspace_id: string }>(
        `SELECT t.*, t.workspace_id FROM time_off t WHERE t.id = $1`,
        [id]
      );

      if (timeOffResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Time-off entry not found' });
      }

      const timeOff = timeOffResult.rows[0];

      // Check permission
      const roleCheck = await fastify.db.query<{ role: string }>(
        `SELECT role FROM user_workspace_roles WHERE workspace_id = $1 AND user_id = $2`,
        [timeOff.workspace_id, request.user.id]
      );

      if (roleCheck.rows.length === 0) {
        return reply.code(403).send({ error: 'Not a member of this workspace' });
      }

      const userRole = roleCheck.rows[0].role;
      const canManageTimeOff = userRole === 'ADMIN' || userRole === 'TEAM_LEAD' || request.user.id === timeOff.user_id;

      if (!canManageTimeOff) {
        return reply.code(403).send({ error: 'Insufficient permissions to manage time-off' });
      }

      await fastify.db.query('DELETE FROM time_off WHERE id = $1', [id]);

      return reply.code(204).send();
    }
  );
}

export default timeOffRoutes;
