import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { TaskService } from '../services/taskService.js';
import { WorkspaceService } from '../services/workspaceService.js';

const createTaskSchema = z.object({
  workspace_id: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  estimated_hours: z.number().min(0).optional(),
  assigned_to_user_id: z.string().uuid().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(['BACKLOG', 'PLANNED', 'IN_PROGRESS', 'BLOCKED', 'DONE']).optional(),
  priority: z.enum(['LOW', 'MED', 'HIGH', 'CRITICAL']).optional(),
  epic_id: z.string().uuid().nullable().optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  estimated_hours: z.number().min(0).optional(),
  assigned_to_user_id: z.string().uuid().nullable().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(['BACKLOG', 'PLANNED', 'IN_PROGRESS', 'BLOCKED', 'DONE']).optional(),
  priority: z.enum(['LOW', 'MED', 'HIGH', 'CRITICAL']).optional(),
  epic_id: z.string().uuid().nullable().optional(),
  position_in_backlog: z.number().int().min(0).nullable().optional(),
});

const taskQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  assigneeId: z.string().uuid().optional(),
  status: z.enum(['BACKLOG', 'PLANNED', 'IN_PROGRESS', 'BLOCKED', 'DONE']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const addDependencySchema = z.object({
  depends_on_task_id: z.string().uuid(),
  type: z.enum(['FS', 'SS', 'FF', 'SF']).optional(),
});

const batchDependenciesSchema = z.object({
  taskIds: z.array(z.string().uuid()),
});

export default async function taskRoutes(fastify: FastifyInstance) {
  const taskService = new TaskService(fastify);
  const workspaceService = new WorkspaceService(fastify);

  // Helper to check workspace access
  async function checkWorkspaceAccess(
    workspaceId: string,
    userId: string,
    reply: FastifyReply,
    requireWrite = false
  ): Promise<boolean> {
    const role = await workspaceService.getUserRole(workspaceId, userId);
    if (!role) {
      reply.status(403).send({ error: 'Access denied', code: 'FORBIDDEN' });
      return false;
    }
    if (requireWrite && role === 'READ_ONLY') {
      reply.status(403).send({ error: 'Write access required', code: 'FORBIDDEN' });
      return false;
    }
    return true;
  }

  // GET /api/tasks
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = taskQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId, assigneeId, status, from, to } = parseResult.data;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      const tasks = await taskService.list({
        workspaceId,
        assigneeId,
        status,
        from,
        to,
        includeUnscheduled: true,
      });

      return reply.send({ tasks });
    }
  );

  // POST /api/tasks
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = createTaskSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      if (!(await checkWorkspaceAccess(parseResult.data.workspace_id, request.user.id, reply, true))) {
        return;
      }

      const task = await taskService.create(parseResult.data);
      return reply.status(201).send({ task });
    }
  );

  // GET /api/tasks/:id
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;

      const task = await taskService.getById(id);
      if (!task) {
        return reply.status(404).send({ error: 'Task not found', code: 'NOT_FOUND' });
      }

      if (!(await checkWorkspaceAccess(task.workspace_id, request.user.id, reply))) {
        return;
      }

      const dependencies = await taskService.getTaskDependencies(id);
      const dependents = await taskService.getTaskDependents(id);

      return reply.send({ task, dependencies, dependents });
    }
  );

  // PATCH /api/tasks/:id
  fastify.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;

      const parseResult = updateTaskSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const existingTask = await taskService.getById(id);
      if (!existingTask) {
        return reply.status(404).send({ error: 'Task not found', code: 'NOT_FOUND' });
      }

      if (!(await checkWorkspaceAccess(existingTask.workspace_id, request.user.id, reply, true))) {
        return;
      }

      try {
        const task = await taskService.update(id, parseResult.data, existingTask);
        return reply.send({ task });
      } catch (err) {
        if ((err as Error).message.includes('Cannot edit fields')) {
          return reply.status(400).send({
            error: (err as Error).message,
            code: 'EXTERNAL_FIELD_EDIT_BLOCKED',
          });
        }
        if ((err as Error).message.includes('Estimated hours must be greater than 0')) {
          return reply.status(400).send({
            error: (err as Error).message,
            code: 'ESTIMATED_HOURS_REQUIRED',
          });
        }
        throw err;
      }
    }
  );

  // DELETE /api/tasks/:id
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;

      const existingTask = await taskService.getById(id);
      if (!existingTask) {
        return reply.status(404).send({ error: 'Task not found', code: 'NOT_FOUND' });
      }

      if (!(await checkWorkspaceAccess(existingTask.workspace_id, request.user.id, reply, true))) {
        return;
      }

      await taskService.delete(id);
      return reply.send({ success: true });
    }
  );

  // POST /api/tasks/:id/dependencies
  fastify.post<{ Params: { id: string } }>(
    '/:id/dependencies',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;

      const parseResult = addDependencySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const task = await taskService.getById(id);
      if (!task) {
        return reply.status(404).send({ error: 'Task not found', code: 'NOT_FOUND' });
      }

      if (!(await checkWorkspaceAccess(task.workspace_id, request.user.id, reply, true))) {
        return;
      }

      // Check that dependent task exists and is in same workspace
      const dependsOnTask = await taskService.getById(parseResult.data.depends_on_task_id);
      if (!dependsOnTask || dependsOnTask.workspace_id !== task.workspace_id) {
        return reply.status(400).send({
          error: 'Dependent task not found or not in same workspace',
          code: 'INVALID_DEPENDENCY',
        });
      }

      // Check for circular dependency
      const wouldCreateCycle = await taskService.hasCircularDependency(
        id,
        parseResult.data.depends_on_task_id
      );
      if (wouldCreateCycle) {
        return reply.status(400).send({
          error: 'Adding this dependency would create a circular reference',
          code: 'CIRCULAR_DEPENDENCY',
        });
      }

      try {
        const dependency = await taskService.addDependency(
          id,
          parseResult.data.depends_on_task_id,
          parseResult.data.type
        );
        return reply.status(201).send({ dependency });
      } catch (err) {
        if ((err as Error).message.includes('duplicate key')) {
          return reply.status(409).send({
            error: 'Dependency already exists',
            code: 'DEPENDENCY_EXISTS',
          });
        }
        throw err;
      }
    }
  );

  // DELETE /api/tasks/:id/dependencies/:depId
  fastify.delete<{ Params: { id: string; depId: string } }>(
    '/:id/dependencies/:depId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id, depId } = request.params;

      const task = await taskService.getById(id);
      if (!task) {
        return reply.status(404).send({ error: 'Task not found', code: 'NOT_FOUND' });
      }

      if (!(await checkWorkspaceAccess(task.workspace_id, request.user.id, reply, true))) {
        return;
      }

      const removed = await taskService.removeDependency(depId);
      if (!removed) {
        return reply.status(404).send({ error: 'Dependency not found', code: 'NOT_FOUND' });
      }

      return reply.send({ success: true });
    }
  );

  // POST /api/tasks/dependencies/batch
  fastify.post(
    '/dependencies/batch',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = batchDependenciesSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { taskIds } = parseResult.data;
      if (taskIds.length === 0) {
        return reply.send({ dependencies: [] });
      }

      // Get the first task to check workspace access
      const firstTask = await taskService.getById(taskIds[0]!);
      if (!firstTask) {
        return reply.status(404).send({ error: 'Task not found', code: 'NOT_FOUND' });
      }

      if (!(await checkWorkspaceAccess(firstTask.workspace_id, request.user.id, reply))) {
        return;
      }

      const dependencies = await taskService.getDependenciesForTasks(taskIds);
      return reply.send({ dependencies });
    }
  );
}
