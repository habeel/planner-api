import type { FastifyInstance } from 'fastify';
import type {
  AIConversation,
  AIMessage,
  AISettings,
  AIStructuredData,
} from '../../types/index.js';
import { OpenAIProvider } from './providers/openai.js';
import type { AIProvider, Message, AssistantMessage, ChatResponse } from './providers/base.js';
import { buildContext } from './context/builder.js';
import {
  summarizeConversationHistory,
  determineContextLevel,
} from './context/summarizer.js';
import { getSystemPrompt } from './prompts/system.js';
import { aiFunctions } from './prompts/functions.js';
import {
  getCurrentUsage,
  incrementUsage,
  checkUsageLimit,
} from './usage/tracker.js';
import { executeFunctionCall } from './functions/executor.js';

// Maximum number of function call rounds to prevent infinite loops
const MAX_FUNCTION_CALL_ROUNDS = 5;

export interface ChatInput {
  workspaceId: string;
  userId: string;
  message: string;
  conversationId?: string;
}

export interface ChatResult {
  conversation: AIConversation;
  userMessage: AIMessage;
  assistantMessage: AIMessage;
  usage: {
    inputTokens: number;
    outputTokens: number;
    monthlyUsed: number;
    monthlyLimit: number;
  };
}

export class AIService {
  private provider: AIProvider | null = null;

  constructor(private fastify: FastifyInstance) {
    this.initializeProvider();
  }

  private initializeProvider(): void {
    const config = this.fastify.config;

    if (config.AI_DEFAULT_PROVIDER === 'openai' && config.OPENAI_API_KEY) {
      this.provider = new OpenAIProvider(
        config.OPENAI_API_KEY,
        config.AI_DEFAULT_MODEL
      );
    }
    // Anthropic provider can be added here in the future
  }

  isConfigured(): boolean {
    return this.provider !== null;
  }

  // ==================== Conversation CRUD ====================

  async createConversation(
    workspaceId: string,
    userId: string,
    title?: string
  ): Promise<AIConversation> {
    const result = await this.fastify.db.query<AIConversation>(
      `
      INSERT INTO ai_conversations (workspace_id, created_by_user_id, title)
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [workspaceId, userId, title || null]
    );

    return result.rows[0]!;
  }

  async getConversation(id: string): Promise<AIConversation | null> {
    const result = await this.fastify.db.query<AIConversation>(
      `SELECT * FROM ai_conversations WHERE id = $1`,
      [id]
    );

    return result.rows[0] || null;
  }

  async listConversations(
    workspaceId: string,
    options: { includeArchived?: boolean; limit?: number } = {}
  ): Promise<AIConversation[]> {
    const { includeArchived = false, limit = 50 } = options;

    const result = await this.fastify.db.query<AIConversation>(
      `
      SELECT * FROM ai_conversations
      WHERE workspace_id = $1
      ${includeArchived ? '' : 'AND is_archived = FALSE'}
      ORDER BY updated_at DESC
      LIMIT $2
      `,
      [workspaceId, limit]
    );

    return result.rows;
  }

  async updateConversation(
    id: string,
    updates: { title?: string; is_archived?: boolean }
  ): Promise<AIConversation | null> {
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: (string | boolean)[] = [];
    let paramIndex = 1;

    if (updates.title !== undefined) {
      setClauses.push(`title = $${paramIndex}`);
      values.push(updates.title);
      paramIndex++;
    }

    if (updates.is_archived !== undefined) {
      setClauses.push(`is_archived = $${paramIndex}`);
      values.push(updates.is_archived);
      paramIndex++;
    }

    values.push(id);

    const result = await this.fastify.db.query<AIConversation>(
      `
      UPDATE ai_conversations
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
      `,
      values
    );

    return result.rows[0] || null;
  }

  async deleteConversation(id: string): Promise<boolean> {
    const result = await this.fastify.db.query(
      `DELETE FROM ai_conversations WHERE id = $1`,
      [id]
    );

    return (result.rowCount || 0) > 0;
  }

  // ==================== Messages ====================

  async getMessages(conversationId: string): Promise<AIMessage[]> {
    const result = await this.fastify.db.query<AIMessage>(
      `
      SELECT * FROM ai_messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC
      `,
      [conversationId]
    );

    return result.rows;
  }

  async addMessage(
    conversationId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    metadata?: {
      inputTokens?: number;
      outputTokens?: number;
      model?: string;
      structuredData?: AIStructuredData;
    }
  ): Promise<AIMessage> {
    const result = await this.fastify.db.query<AIMessage>(
      `
      INSERT INTO ai_messages (conversation_id, role, content, input_tokens, output_tokens, model, structured_data)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [
        conversationId,
        role,
        content,
        metadata?.inputTokens || null,
        metadata?.outputTokens || null,
        metadata?.model || null,
        metadata?.structuredData ? JSON.stringify(metadata.structuredData) : null,
      ]
    );

    // Update conversation's updated_at
    await this.fastify.db.query(
      `UPDATE ai_conversations SET updated_at = NOW() WHERE id = $1`,
      [conversationId]
    );

    return result.rows[0]!;
  }

  // ==================== Chat ====================

  async chat(input: ChatInput): Promise<ChatResult> {
    if (!this.provider) {
      throw new Error('AI provider not configured');
    }

    const { workspaceId, userId, message, conversationId } = input;
    const config = this.fastify.config;

    // Check usage limits
    const usageCheck = await checkUsageLimit(
      this.fastify.db,
      workspaceId,
      config.AI_MONTHLY_TOKEN_LIMIT_DEFAULT
    );

    if (!usageCheck.allowed) {
      throw new Error('Monthly AI usage limit reached');
    }

    // Get or create conversation
    let conversation: AIConversation;
    if (conversationId) {
      const existing = await this.getConversation(conversationId);
      if (!existing) {
        throw new Error('Conversation not found');
      }
      conversation = existing;
    } else {
      conversation = await this.createConversation(workspaceId, userId);
    }

    // Save user message
    const userMessage = await this.addMessage(conversation.id, 'user', message);

    // Get existing messages for context
    const existingMessages = await this.getMessages(conversation.id);

    // Determine context level based on user message
    const contextLevel = determineContextLevel(message);

    // Build workspace context
    const workspaceContext = await buildContext(
      this.fastify.db,
      workspaceId,
      contextLevel
    );

    // Prepare messages for AI
    const systemPrompt = getSystemPrompt(workspaceContext);

    // Summarize if conversation is long
    const conversationMessages = await summarizeConversationHistory(
      this.provider,
      existingMessages
    );

    const aiMessages: Message[] = [
      { role: 'system', content: systemPrompt },
      ...conversationMessages,
    ];

    // Call AI provider with function call loop
    let response = await this.provider.chat({
      messages: aiMessages,
      functions: aiFunctions,
      temperature: config.AI_TEMPERATURE,
      maxTokens: config.AI_MAX_TOKENS_PER_REQUEST,
    });

    // Track total usage across function call rounds
    let totalInputTokens = response.usage.inputTokens;
    let totalOutputTokens = response.usage.outputTokens;

    // Function call loop - process tool calls until AI provides a final response
    let functionCallRound = 0;
    while (response.toolCalls && response.toolCalls.length > 0 && functionCallRound < MAX_FUNCTION_CALL_ROUNDS) {
      functionCallRound++;

      // Execute all function calls in parallel
      const toolResults = await Promise.all(
        response.toolCalls.map((tc) =>
          executeFunctionCall(this.fastify.db, workspaceId, tc)
        )
      );

      // Build the assistant message with tool calls to send back
      const assistantMessageWithTools: AssistantMessage = {
        role: 'assistant',
        content: response.content || '',
        toolCalls: response.toolCalls,
      };

      // Add assistant message and tool results to the conversation
      aiMessages.push(assistantMessageWithTools, ...toolResults);

      // Call AI again with the function results
      response = await this.provider.chat({
        messages: aiMessages,
        functions: aiFunctions,
        temperature: config.AI_TEMPERATURE,
        maxTokens: config.AI_MAX_TOKENS_PER_REQUEST,
      });

      // Accumulate token usage
      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;
    }

    // Parse structured data from final response
    const structuredData = parseStructuredData(response.content);

    // Save assistant message with total token usage
    const assistantMessage = await this.addMessage(
      conversation.id,
      'assistant',
      response.content,
      {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        model: response.model,
        structuredData: structuredData || undefined,
      }
    );

    // Update usage with total tokens
    const updatedUsage = await incrementUsage(
      this.fastify.db,
      workspaceId,
      totalInputTokens,
      totalOutputTokens
    );

    // Auto-generate title for new conversations
    if (!conversationId && !conversation.title) {
      const title = generateConversationTitle(message);
      await this.updateConversation(conversation.id, { title });
      conversation.title = title;
    }

    return {
      conversation,
      userMessage,
      assistantMessage,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        monthlyUsed:
          Number(updatedUsage.input_tokens_used) +
          Number(updatedUsage.output_tokens_used),
        monthlyLimit: usageCheck.limit,
      },
    };
  }

  // ==================== Settings ====================

  async getSettings(workspaceId: string): Promise<AISettings | null> {
    const result = await this.fastify.db.query<AISettings>(
      `SELECT * FROM ai_settings WHERE workspace_id = $1`,
      [workspaceId]
    );

    return result.rows[0] || null;
  }

  async updateSettings(
    workspaceId: string,
    settings: Partial<Omit<AISettings, 'workspace_id' | 'created_at' | 'updated_at'>>
  ): Promise<AISettings> {
    // Upsert settings
    const result = await this.fastify.db.query<AISettings>(
      `
      INSERT INTO ai_settings (workspace_id, enabled, preferred_provider, preferred_model, monthly_token_limit)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (workspace_id)
      DO UPDATE SET
        enabled = COALESCE($2, ai_settings.enabled),
        preferred_provider = COALESCE($3, ai_settings.preferred_provider),
        preferred_model = COALESCE($4, ai_settings.preferred_model),
        monthly_token_limit = COALESCE($5, ai_settings.monthly_token_limit),
        updated_at = NOW()
      RETURNING *
      `,
      [
        workspaceId,
        settings.enabled ?? true,
        settings.preferred_provider ?? 'openai',
        settings.preferred_model ?? 'gpt-4o-mini',
        settings.monthly_token_limit ?? null,
      ]
    );

    return result.rows[0]!;
  }

  async getUsage(workspaceId: string): Promise<{
    current: { inputTokens: number; outputTokens: number; requestCount: number };
    limit: number;
  }> {
    const usage = await getCurrentUsage(this.fastify.db, workspaceId);
    const settings = await this.getSettings(workspaceId);

    return {
      current: {
        inputTokens: Number(usage.input_tokens_used),
        outputTokens: Number(usage.output_tokens_used),
        requestCount: usage.request_count,
      },
      limit:
        settings?.monthly_token_limit ||
        this.fastify.config.AI_MONTHLY_TOKEN_LIMIT_DEFAULT,
    };
  }
}

/**
 * Parse structured data from AI response content.
 * Looks for JSON blocks in the format: ```json:type_name\n{...}\n```
 */
function parseStructuredData(content: string): AIStructuredData | null {
  // Match JSON blocks with type annotations
  const jsonBlockRegex = /```json:(\w+)\s*([\s\S]*?)```/g;
  let match = jsonBlockRegex.exec(content);

  if (match) {
    try {
      const jsonContent = match[2].trim();
      const parsed = JSON.parse(jsonContent) as AIStructuredData;
      return parsed;
    } catch {
      // Invalid JSON, ignore
    }
  }

  // Try to find plain JSON blocks
  const plainJsonRegex = /```json\s*([\s\S]*?)```/g;
  match = plainJsonRegex.exec(content);

  if (match) {
    try {
      const jsonContent = match[1].trim();
      const parsed = JSON.parse(jsonContent) as AIStructuredData;
      if (parsed && typeof parsed === 'object' && 'type' in parsed) {
        return parsed;
      }
    } catch {
      // Invalid JSON, ignore
    }
  }

  return null;
}

/**
 * Generate a conversation title from the first message.
 */
function generateConversationTitle(message: string): string {
  // Truncate to first 50 characters
  const truncated = message.slice(0, 50).trim();
  return truncated.length < message.length ? `${truncated}...` : truncated;
}
