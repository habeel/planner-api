import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AIService } from '../services/ai/index.js';
import { WorkspaceService } from '../services/workspaceService.js';

// Request schemas
const chatSchema = z.object({
  workspaceId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(4000),
});

const conversationQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  includeArchived: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

const createConversationSchema = z.object({
  workspaceId: z.string().uuid(),
  title: z.string().max(255).optional(),
});

const updateConversationSchema = z.object({
  title: z.string().max(255).optional(),
  is_archived: z.boolean().optional(),
});

const updateSettingsSchema = z.object({
  workspaceId: z.string().uuid(),
  enabled: z.boolean().optional(),
  preferred_provider: z.enum(['openai', 'anthropic']).optional(),
  preferred_model: z.string().max(50).optional(),
  monthly_token_limit: z.number().positive().optional().nullable(),
});

const usageQuerySchema = z.object({
  workspaceId: z.string().uuid(),
});

export default async function aiRoutes(fastify: FastifyInstance) {
  const aiService = new AIService(fastify);
  const workspaceService = new WorkspaceService(fastify);

  /**
   * Check if user has access to AI features (Admin or Team Lead only)
   */
  async function checkAIAccess(
    workspaceId: string,
    userId: string,
    reply: FastifyReply
  ): Promise<boolean> {
    const role = await workspaceService.getUserRole(workspaceId, userId);

    if (!role || !['ADMIN', 'TEAM_LEAD'].includes(role)) {
      reply.status(403).send({
        error: 'AI Project Manager requires Admin or Team Lead role',
        code: 'FORBIDDEN',
      });
      return false;
    }

    return true;
  }

  /**
   * Check if conversation belongs to workspace
   */
  async function checkConversationAccess(
    conversationId: string,
    workspaceId: string,
    reply: FastifyReply
  ): Promise<boolean> {
    const conversation = await aiService.getConversation(conversationId);

    if (!conversation) {
      reply.status(404).send({
        error: 'Conversation not found',
        code: 'NOT_FOUND',
      });
      return false;
    }

    if (conversation.workspace_id !== workspaceId) {
      reply.status(403).send({
        error: 'Conversation does not belong to this workspace',
        code: 'FORBIDDEN',
      });
      return false;
    }

    return true;
  }

  // ==================== Chat Endpoint ====================

  fastify.post(
    '/chat',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = chatSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId, conversationId, message } = parseResult.data;
      const userId = request.user.id;

      if (!(await checkAIAccess(workspaceId, userId, reply))) {
        return;
      }

      // Check conversation access if provided
      if (conversationId) {
        if (!(await checkConversationAccess(conversationId, workspaceId, reply))) {
          return;
        }
      }

      // Check if AI is configured
      if (!aiService.isConfigured()) {
        return reply.status(503).send({
          error: 'AI service is not configured. Please add OPENAI_API_KEY to environment.',
          code: 'SERVICE_UNAVAILABLE',
        });
      }

      try {
        const result = await aiService.chat({
          workspaceId,
          userId,
          message,
          conversationId,
        });

        return reply.send({
          conversationId: result.conversation.id,
          message: result.assistantMessage,
          usage: result.usage,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        if (errorMessage.includes('usage limit')) {
          return reply.status(429).send({
            error: errorMessage,
            code: 'USAGE_LIMIT_EXCEEDED',
          });
        }

        fastify.log.error(error, 'AI chat error');
        return reply.status(500).send({
          error: 'Failed to process AI request',
          code: 'AI_ERROR',
        });
      }
    }
  );

  // ==================== Conversation Endpoints ====================

  // List conversations
  fastify.get(
    '/conversations',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = conversationQuerySchema.safeParse(request.query);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId, includeArchived } = parseResult.data;
      const userId = request.user.id;

      if (!(await checkAIAccess(workspaceId, userId, reply))) {
        return;
      }

      const conversations = await aiService.listConversations(workspaceId, {
        includeArchived,
      });

      return reply.send({ conversations });
    }
  );

  // Get single conversation with messages
  fastify.get<{ Params: { id: string }; Querystring: { workspaceId: string } }>(
    '/conversations/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const workspaceId = request.query.workspaceId;

      if (!workspaceId) {
        return reply.status(400).send({
          error: 'workspaceId query parameter is required',
          code: 'INVALID_INPUT',
        });
      }

      const userId = request.user.id;

      if (!(await checkAIAccess(workspaceId, userId, reply))) {
        return;
      }

      if (!(await checkConversationAccess(id, workspaceId, reply))) {
        return;
      }

      const conversation = await aiService.getConversation(id);
      const messages = await aiService.getMessages(id);

      return reply.send({ conversation, messages });
    }
  );

  // Create new conversation
  fastify.post(
    '/conversations',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = createConversationSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId, title } = parseResult.data;
      const userId = request.user.id;

      if (!(await checkAIAccess(workspaceId, userId, reply))) {
        return;
      }

      const conversation = await aiService.createConversation(
        workspaceId,
        userId,
        title
      );

      return reply.status(201).send({ conversation });
    }
  );

  // Update conversation
  fastify.patch<{ Params: { id: string } }>(
    '/conversations/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;

      const bodyParseResult = updateConversationSchema.safeParse(request.body);
      if (!bodyParseResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          code: 'INVALID_INPUT',
          details: bodyParseResult.error.flatten(),
        });
      }

      const queryParseResult = z
        .object({ workspaceId: z.string().uuid() })
        .safeParse(request.query);
      if (!queryParseResult.success) {
        return reply.status(400).send({
          error: 'workspaceId query parameter is required',
          code: 'INVALID_INPUT',
        });
      }

      const { workspaceId } = queryParseResult.data;
      const userId = request.user.id;

      if (!(await checkAIAccess(workspaceId, userId, reply))) {
        return;
      }

      if (!(await checkConversationAccess(id, workspaceId, reply))) {
        return;
      }

      const conversation = await aiService.updateConversation(id, bodyParseResult.data);

      return reply.send({ conversation });
    }
  );

  // Delete conversation
  fastify.delete<{ Params: { id: string }; Querystring: { workspaceId: string } }>(
    '/conversations/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params;
      const workspaceId = request.query.workspaceId;

      if (!workspaceId) {
        return reply.status(400).send({
          error: 'workspaceId query parameter is required',
          code: 'INVALID_INPUT',
        });
      }

      const userId = request.user.id;

      if (!(await checkAIAccess(workspaceId, userId, reply))) {
        return;
      }

      if (!(await checkConversationAccess(id, workspaceId, reply))) {
        return;
      }

      await aiService.deleteConversation(id);

      return reply.status(204).send();
    }
  );

  // ==================== Usage Endpoint ====================

  fastify.get(
    '/usage',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = usageQuerySchema.safeParse(request.query);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId } = parseResult.data;
      const userId = request.user.id;

      if (!(await checkAIAccess(workspaceId, userId, reply))) {
        return;
      }

      const usage = await aiService.getUsage(workspaceId);

      return reply.send({ usage });
    }
  );

  // ==================== Settings Endpoints ====================

  fastify.get(
    '/settings',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = usageQuerySchema.safeParse(request.query);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId } = parseResult.data;
      const userId = request.user.id;

      // Only admins can view settings
      const role = await workspaceService.getUserRole(workspaceId, userId);
      if (role !== 'ADMIN') {
        return reply.status(403).send({
          error: 'Only workspace admins can view AI settings',
          code: 'FORBIDDEN',
        });
      }

      const settings = await aiService.getSettings(workspaceId);

      return reply.send({
        settings: settings || {
          workspace_id: workspaceId,
          enabled: false,
          preferred_provider: 'openai',
          preferred_model: 'gpt-4o-mini',
          monthly_token_limit: null,
        },
      });
    }
  );

  fastify.patch(
    '/settings',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = updateSettingsSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId, ...settingsUpdate } = parseResult.data;
      const userId = request.user.id;

      // Only admins can update settings
      const role = await workspaceService.getUserRole(workspaceId, userId);
      if (role !== 'ADMIN') {
        return reply.status(403).send({
          error: 'Only workspace admins can update AI settings',
          code: 'FORBIDDEN',
        });
      }

      const settings = await aiService.updateSettings(workspaceId, settingsUpdate);

      return reply.send({ settings });
    }
  );
}
