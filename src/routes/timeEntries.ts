import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { TimeEntryService } from '../services/timeEntryService.js';
import { TaskService } from '../services/taskService.js';
import { WorkspaceService } from '../services/workspaceService.js';

const createTimeEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hours: z.number().positive().max(24),
  notes: z.string().optional(),
});

const updateTimeEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hours: z.number().positive().max(24).optional(),
  notes: z.string().nullable().optional(),
});

const batchSummarySchema = z.object({
  taskIds: z.array(z.string().uuid()),
});

export default async function timeEntryRoutes(fastify: FastifyInstance) {
  const timeEntryService = new TimeEntryService(fastify);
  const taskService = new TaskService(fastify);
  const workspaceService = new WorkspaceService(fastify);

  // Helper to check workspace access via task
  async function checkTaskAccess(
    taskId: string,
    userId: string,
    reply: FastifyReply,
    requireWrite = false
  ): Promise<{ task: Awaited<ReturnType<typeof taskService.getById>>; hasAccess: boolean }> {
    const task = await taskService.getById(taskId);
    if (!task) {
      reply.status(404).send({ error: 'Task not found', code: 'NOT_FOUND' });
      return { task: null, hasAccess: false };
    }

    const role = await workspaceService.getUserRole(task.workspace_id, userId);
    if (!role) {
      reply.status(403).send({ error: 'Access denied', code: 'FORBIDDEN' });
      return { task, hasAccess: false };
    }
    if (requireWrite && role === 'READ_ONLY') {
      reply.status(403).send({ error: 'Write access required', code: 'FORBIDDEN' });
      return { task, hasAccess: false };
    }

    return { task, hasAccess: true };
  }

  // GET /api/tasks/:taskId/time-entries - List time entries for a task
  fastify.get<{ Params: { taskId: string } }>(
    '/:taskId/time-entries',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { taskId } = request.params;

      const { hasAccess } = await checkTaskAccess(taskId, request.user.id, reply);
      if (!hasAccess) return;

      const entries = await timeEntryService.listByTask(taskId);
      const totalHours = await timeEntryService.getTotalHoursForTask(taskId);

      return reply.send({ entries, totalHours });
    }
  );

  // POST /api/tasks/:taskId/time-entries - Create a time entry
  fastify.post<{ Params: { taskId: string } }>(
    '/:taskId/time-entries',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { taskId } = request.params;

      const parseResult = createTimeEntrySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { hasAccess } = await checkTaskAccess(taskId, request.user.id, reply, true);
      if (!hasAccess) return;

      const entry = await timeEntryService.create({
        task_id: taskId,
        user_id: request.user.id,
        date: parseResult.data.date,
        hours: parseResult.data.hours,
        notes: parseResult.data.notes,
      });

      return reply.status(201).send({ entry });
    }
  );

  // PATCH /api/tasks/:taskId/time-entries/:entryId - Update a time entry
  fastify.patch<{ Params: { taskId: string; entryId: string } }>(
    '/:taskId/time-entries/:entryId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { taskId, entryId } = request.params;

      const parseResult = updateTimeEntrySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { hasAccess } = await checkTaskAccess(taskId, request.user.id, reply, true);
      if (!hasAccess) return;

      // Verify entry belongs to this task
      const existingEntry = await timeEntryService.getById(entryId);
      if (!existingEntry || existingEntry.task_id !== taskId) {
        return reply.status(404).send({ error: 'Time entry not found', code: 'NOT_FOUND' });
      }

      // Only allow editing own entries (or admins/team leads could edit all)
      if (existingEntry.user_id !== request.user.id) {
        return reply.status(403).send({
          error: 'Can only edit your own time entries',
          code: 'FORBIDDEN',
        });
      }

      const entry = await timeEntryService.update(entryId, parseResult.data);
      return reply.send({ entry });
    }
  );

  // DELETE /api/tasks/:taskId/time-entries/:entryId - Delete a time entry
  fastify.delete<{ Params: { taskId: string; entryId: string } }>(
    '/:taskId/time-entries/:entryId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { taskId, entryId } = request.params;

      const { hasAccess } = await checkTaskAccess(taskId, request.user.id, reply, true);
      if (!hasAccess) return;

      // Verify entry belongs to this task
      const existingEntry = await timeEntryService.getById(entryId);
      if (!existingEntry || existingEntry.task_id !== taskId) {
        return reply.status(404).send({ error: 'Time entry not found', code: 'NOT_FOUND' });
      }

      // Only allow deleting own entries
      if (existingEntry.user_id !== request.user.id) {
        return reply.status(403).send({
          error: 'Can only delete your own time entries',
          code: 'FORBIDDEN',
        });
      }

      await timeEntryService.delete(entryId);
      return reply.send({ success: true });
    }
  );

  // POST /api/tasks/time-entries/summary - Get summary for multiple tasks
  fastify.post(
    '/time-entries/summary',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = batchSummarySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { taskIds } = parseResult.data;
      if (taskIds.length === 0) {
        return reply.send({ summaries: [] });
      }

      // Check access via first task (assumes all tasks are in same workspace)
      const { hasAccess } = await checkTaskAccess(taskIds[0]!, request.user.id, reply);
      if (!hasAccess) return;

      const summaries = await timeEntryService.getSummaryForTasks(taskIds);
      return reply.send({ summaries });
    }
  );
}
