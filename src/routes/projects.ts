import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ProjectService } from '../services/projectService.js';
import { WorkspaceService } from '../services/workspaceService.js';

const createProjectSchema = z.object({
  workspace_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  goals: z.string().optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  goals: z.string().optional(),
  status: z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']).optional(),
});

const projectQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  status: z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']).optional(),
});

const createEpicSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MED', 'HIGH', 'CRITICAL']).optional(),
  estimated_weeks: z.number().positive().optional(),
});

const updateEpicSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  status: z.enum(['draft', 'ready_for_breakdown', 'breaking_down', 'ready', 'in_progress', 'done']).optional(),
  priority: z.enum(['LOW', 'MED', 'HIGH', 'CRITICAL']).optional(),
  estimated_weeks: z.number().positive().nullable().optional(),
  sort_order: z.number().int().min(0).optional(),
});

const epicQuerySchema = z.object({
  workspaceId: z.string().uuid(),
});

const addDependencySchema = z.object({
  depends_on_epic_id: z.string().uuid(),
  dependency_type: z.enum(['blocks', 'related', 'informs']).optional(),
});

const bulkStoriesSchema = z.object({
  stories: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      estimated_hours: z.number().min(0).optional(),
      priority: z.enum(['LOW', 'MED', 'HIGH', 'CRITICAL']).optional(),
    })
  ),
});

export default async function projectRoutes(fastify: FastifyInstance) {
  const projectService = new ProjectService(fastify);
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

  // ============================================
  // PROJECTS
  // ============================================

  // GET /api/projects
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = projectQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId, status } = parseResult.data;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      const projects = await projectService.list(workspaceId, status);
      return reply.send({ projects });
    }
  );

  // GET /api/projects/:id
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const parseResult = epicQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId } = parseResult.data;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      const project = await projectService.getWithEpics(id, workspaceId);
      if (!project) {
        return reply.status(404).send({ error: 'Project not found', code: 'NOT_FOUND' });
      }

      return reply.send({ project });
    }
  );

  // POST /api/projects
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = createProjectSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspace_id, name, description, goals } = parseResult.data;

      if (!(await checkWorkspaceAccess(workspace_id, request.user.id, reply, true))) {
        return;
      }

      const project = await projectService.create({
        workspace_id,
        name,
        description,
        goals,
        created_by: request.user.id,
      });

      return reply.status(201).send({ project });
    }
  );

  // PATCH /api/projects/:id
  fastify.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const queryResult = epicQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          code: 'INVALID_INPUT',
          details: queryResult.error.flatten(),
        });
      }

      const bodyResult = updateProjectSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          code: 'INVALID_INPUT',
          details: bodyResult.error.flatten(),
        });
      }

      const { workspaceId } = queryResult.data;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply, true))) {
        return;
      }

      const project = await projectService.update(id, workspaceId, bodyResult.data);
      if (!project) {
        return reply.status(404).send({ error: 'Project not found', code: 'NOT_FOUND' });
      }

      return reply.send({ project });
    }
  );

  // DELETE /api/projects/:id
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const parseResult = epicQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId } = parseResult.data;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply, true))) {
        return;
      }

      const deleted = await projectService.delete(id, workspaceId);
      if (!deleted) {
        return reply.status(404).send({ error: 'Project not found', code: 'NOT_FOUND' });
      }

      return reply.send({ success: true });
    }
  );

  // ============================================
  // EPICS (nested under projects)
  // ============================================

  // GET /api/projects/:id/epics
  fastify.get<{ Params: { id: string } }>(
    '/:id/epics',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const parseResult = epicQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId } = parseResult.data;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      const epics = await projectService.getEpicsForProject(id, workspaceId);
      return reply.send({ epics });
    }
  );

  // POST /api/projects/:id/epics
  fastify.post<{ Params: { id: string } }>(
    '/:id/epics',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id: project_id } = request.params;
      const queryResult = epicQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          code: 'INVALID_INPUT',
          details: queryResult.error.flatten(),
        });
      }

      const bodyResult = createEpicSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          code: 'INVALID_INPUT',
          details: bodyResult.error.flatten(),
        });
      }

      const { workspaceId } = queryResult.data;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply, true))) {
        return;
      }

      // Verify project exists
      const project = await projectService.getById(project_id);
      if (!project || project.workspace_id !== workspaceId) {
        return reply.status(404).send({ error: 'Project not found', code: 'NOT_FOUND' });
      }

      const epic = await projectService.createEpic({
        project_id,
        workspace_id: workspaceId,
        ...bodyResult.data,
      });

      return reply.status(201).send({ epic });
    }
  );
}

// ============================================
// EPIC ROUTES (separate plugin for /api/epics)
// ============================================

export async function epicRoutes(fastify: FastifyInstance) {
  const projectService = new ProjectService(fastify);
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

  const epicQuerySchema = z.object({
    workspaceId: z.string().uuid(),
  });

  const updateEpicSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().optional(),
    status: z.enum(['draft', 'ready_for_breakdown', 'breaking_down', 'ready', 'in_progress', 'done']).optional(),
    priority: z.enum(['LOW', 'MED', 'HIGH', 'CRITICAL']).optional(),
    estimated_weeks: z.number().positive().nullable().optional(),
    sort_order: z.number().int().min(0).optional(),
  });

  const addDependencySchema = z.object({
    depends_on_epic_id: z.string().uuid(),
    dependency_type: z.enum(['blocks', 'related', 'informs']).optional(),
  });

  const bulkStoriesSchema = z.object({
    stories: z.array(
      z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        estimated_hours: z.number().min(0).optional(),
        priority: z.enum(['LOW', 'MED', 'HIGH', 'CRITICAL']).optional(),
      })
    ),
  });

  // GET /api/epics/:id
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const parseResult = epicQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId } = parseResult.data;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      const epic = await projectService.getEpicWithDependencies(id, workspaceId);
      if (!epic) {
        return reply.status(404).send({ error: 'Epic not found', code: 'NOT_FOUND' });
      }

      return reply.send({ epic });
    }
  );

  // PATCH /api/epics/:id
  fastify.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const queryResult = epicQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          code: 'INVALID_INPUT',
          details: queryResult.error.flatten(),
        });
      }

      const bodyResult = updateEpicSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          code: 'INVALID_INPUT',
          details: bodyResult.error.flatten(),
        });
      }

      const { workspaceId } = queryResult.data;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply, true))) {
        return;
      }

      const epic = await projectService.updateEpic(id, workspaceId, bodyResult.data);
      if (!epic) {
        return reply.status(404).send({ error: 'Epic not found', code: 'NOT_FOUND' });
      }

      return reply.send({ epic });
    }
  );

  // DELETE /api/epics/:id
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const parseResult = epicQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId } = parseResult.data;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply, true))) {
        return;
      }

      const deleted = await projectService.deleteEpic(id, workspaceId);
      if (!deleted) {
        return reply.status(404).send({ error: 'Epic not found', code: 'NOT_FOUND' });
      }

      return reply.send({ success: true });
    }
  );

  // ============================================
  // EPIC DEPENDENCIES
  // ============================================

  // POST /api/epics/:id/dependencies
  fastify.post<{ Params: { id: string } }>(
    '/:id/dependencies',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const queryResult = epicQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          code: 'INVALID_INPUT',
          details: queryResult.error.flatten(),
        });
      }

      const bodyResult = addDependencySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          code: 'INVALID_INPUT',
          details: bodyResult.error.flatten(),
        });
      }

      const { workspaceId } = queryResult.data;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply, true))) {
        return;
      }

      try {
        const dependency = await projectService.addDependency(
          id,
          bodyResult.data.depends_on_epic_id,
          bodyResult.data.dependency_type
        );
        return reply.status(201).send({ dependency });
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.includes('circular')) {
            return reply.status(400).send({ error: error.message, code: 'CIRCULAR_DEPENDENCY' });
          }
          if (error.message.includes('already exists')) {
            return reply.status(409).send({ error: error.message, code: 'DUPLICATE' });
          }
        }
        throw error;
      }
    }
  );

  // DELETE /api/epics/:id/dependencies/:depId
  fastify.delete<{ Params: { id: string; depId: string } }>(
    '/:id/dependencies/:depId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id, depId } = request.params;
      const parseResult = epicQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId } = parseResult.data;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply, true))) {
        return;
      }

      const removed = await projectService.removeDependency(id, depId);
      if (!removed) {
        return reply.status(404).send({ error: 'Dependency not found', code: 'NOT_FOUND' });
      }

      return reply.send({ success: true });
    }
  );

  // ============================================
  // EPIC STORIES (TASKS)
  // ============================================

  // GET /api/epics/:id/stories
  fastify.get<{ Params: { id: string } }>(
    '/:id/stories',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const parseResult = epicQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId } = parseResult.data;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      const stories = await projectService.getStoriesForEpic(id, workspaceId);
      return reply.send({ stories });
    }
  );

  // POST /api/epics/:id/stories
  fastify.post<{ Params: { id: string } }>(
    '/:id/stories',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const queryResult = epicQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          code: 'INVALID_INPUT',
          details: queryResult.error.flatten(),
        });
      }

      const bodyResult = bulkStoriesSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          code: 'INVALID_INPUT',
          details: bodyResult.error.flatten(),
        });
      }

      const { workspaceId } = queryResult.data;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply, true))) {
        return;
      }

      await projectService.createStoriesForEpic(id, workspaceId, bodyResult.data.stories);
      return reply.status(201).send({ success: true, count: bodyResult.data.stories.length });
    }
  );
}
