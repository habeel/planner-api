import type { AIMessage } from '../../../types/index.js';
import type { AIProvider, Message } from '../providers/base.js';
import { getConversationSummaryPrompt } from '../prompts/system.js';

const MAX_MESSAGES_BEFORE_SUMMARY = 10;
const RECENT_MESSAGES_TO_KEEP = 6;

/**
 * Summarizes older messages in a conversation to reduce token usage.
 * Keeps the most recent messages intact while condensing older ones.
 */
export async function summarizeConversationHistory(
  provider: AIProvider,
  messages: AIMessage[]
): Promise<Message[]> {
  // Filter out system messages and only process user/assistant messages
  const conversationMessages = messages.filter((m) => m.role !== 'system');

  // If we don't have enough messages, return as-is
  if (conversationMessages.length <= MAX_MESSAGES_BEFORE_SUMMARY) {
    return conversationMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  // Keep recent messages as-is
  const recentMessages = conversationMessages.slice(-RECENT_MESSAGES_TO_KEEP);
  const oldMessages = conversationMessages.slice(0, -RECENT_MESSAGES_TO_KEEP);

  // Generate summary of old messages
  const summaryMessages: Message[] = [
    { role: 'system', content: getConversationSummaryPrompt() },
    ...oldMessages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  try {
    const summaryResponse = await provider.chat({
      messages: summaryMessages,
      maxTokens: 500,
      temperature: 0.3,
    });

    // Return summary as a system message plus recent messages
    return [
      {
        role: 'system',
        content: `Previous conversation summary: ${summaryResponse.content}`,
      },
      ...recentMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ];
  } catch (error) {
    // If summarization fails, just truncate to recent messages
    console.error('Failed to summarize conversation:', error);
    return recentMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }
}

/**
 * Determines the appropriate context level based on the user's message.
 * Analyzes keywords to decide how much workspace data to include.
 */
export function determineContextLevel(
  message: string
): 'minimal' | 'scheduling' | 'backlog' | 'full' {
  const lowerMessage = message.toLowerCase();

  // Full context keywords
  const fullKeywords = [
    'analyze',
    'overview',
    'status report',
    'full picture',
    'everything',
  ];
  if (fullKeywords.some((kw) => lowerMessage.includes(kw))) {
    return 'full';
  }

  // Scheduling keywords
  const schedulingKeywords = [
    'schedule',
    'sprint',
    'week',
    'capacity',
    'assign',
    'plan',
    'overload',
    'availability',
    'time off',
  ];
  if (schedulingKeywords.some((kw) => lowerMessage.includes(kw))) {
    return 'scheduling';
  }

  // Backlog keywords
  const backlogKeywords = [
    'backlog',
    'prioritize',
    'priority',
    'unscheduled',
    'pending',
    'queue',
  ];
  if (backlogKeywords.some((kw) => lowerMessage.includes(kw))) {
    return 'backlog';
  }

  // Default to minimal for simple queries
  return 'minimal';
}
