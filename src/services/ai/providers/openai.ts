import OpenAI from 'openai';
import { AIProvider, ChatRequest, ChatResponse, Message, ToolCall } from './base.js';

export class OpenAIProvider extends AIProvider {
  name = 'openai';
  private client: OpenAI;
  private defaultModel: string;

  constructor(apiKey: string, defaultModel: string = 'gpt-4o-mini') {
    super();
    this.client = new OpenAI({ apiKey });
    this.defaultModel = defaultModel;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const model = request.model || this.defaultModel;

    // Map our message types to OpenAI's format
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = request.messages.map(
      (m: Message): OpenAI.Chat.ChatCompletionMessageParam => {
        if (m.role === 'tool') {
          return {
            role: 'tool',
            content: m.content,
            tool_call_id: m.toolCallId,
          };
        }
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: 'assistant',
            content: m.content || null,
            tool_calls: m.toolCalls.map(tc => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          };
        }
        return {
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        };
      }
    );

    const tools: OpenAI.Chat.ChatCompletionTool[] | undefined = request.functions?.map(
      (f) => ({
        type: 'function' as const,
        function: {
          name: f.name,
          description: f.description,
          parameters: f.parameters,
        },
      })
    );

    const response = await this.client.chat.completions.create({
      model,
      messages,
      tools: tools && tools.length > 0 ? tools : undefined,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 2000,
      response_format:
        request.responseFormat === 'json' ? { type: 'json_object' } : undefined,
    });

    const choice = response.choices[0];
    const message = choice?.message;

    const functionToolCalls = message?.tool_calls
      ?.filter((tc): tc is OpenAI.Chat.ChatCompletionMessageToolCall & { type: 'function' } =>
        tc.type === 'function'
      );

    // Legacy functionCalls (without IDs) for backward compatibility
    const functionCalls = functionToolCalls?.map((tc) => ({
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    // New toolCalls (with IDs) for the function call loop
    const toolCalls: ToolCall[] | undefined = functionToolCalls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    return {
      content: message?.content || '',
      functionCalls: functionCalls && functionCalls.length > 0 ? functionCalls : undefined,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      },
      model: response.model,
    };
  }

  getAvailableModels(): string[] {
    return ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'];
  }

  getDefaultModel(): string {
    return this.defaultModel;
  }

  override isConfigured(): boolean {
    return !!this.client;
  }
}
