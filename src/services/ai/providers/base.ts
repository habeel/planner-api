// Base AI Provider interface and types

export interface SystemMessage {
  role: 'system';
  content: string;
}

export interface UserMessage {
  role: 'user';
  content: string;
}

export interface AssistantMessage {
  role: 'assistant';
  content: string;
  toolCalls?: ToolCall[];
}

export interface ToolMessage {
  role: 'tool';
  content: string;
  toolCallId: string;
}

// Union type for all message types
export type Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

// Legacy simple message (for backwards compatibility)
export interface SimpleMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  messages: Message[];
  functions?: FunctionDefinition[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
  model?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface FunctionCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResponse {
  content: string;
  functionCalls?: FunctionCall[];
  toolCalls?: ToolCall[];  // Include IDs for tool response loop
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  model: string;
}

export abstract class AIProvider {
  abstract name: string;

  abstract chat(request: ChatRequest): Promise<ChatResponse>;

  abstract getAvailableModels(): string[];

  abstract getDefaultModel(): string;

  isConfigured(): boolean {
    return true;
  }
}
