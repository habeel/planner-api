import type { Pool } from 'pg';
import type { AIUsage } from '../../../types/index.js';

/**
 * Get the current month's first day for usage tracking.
 */
function getCurrentMonthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * Get usage stats for the current month.
 */
export async function getCurrentUsage(
  db: Pool,
  workspaceId: string
): Promise<AIUsage> {
  const monthStart = getCurrentMonthStart();

  const result = await db.query<AIUsage>(
    `
    SELECT id, workspace_id, month, input_tokens_used, output_tokens_used, request_count
    FROM ai_usage
    WHERE workspace_id = $1 AND month = $2
    `,
    [workspaceId, monthStart]
  );

  if (result.rows[0]) {
    return result.rows[0];
  }

  // Create initial usage record
  const insertResult = await db.query<AIUsage>(
    `
    INSERT INTO ai_usage (workspace_id, month, input_tokens_used, output_tokens_used, request_count)
    VALUES ($1, $2, 0, 0, 0)
    RETURNING id, workspace_id, month, input_tokens_used, output_tokens_used, request_count
    `,
    [workspaceId, monthStart]
  );

  return insertResult.rows[0]!;
}

/**
 * Increment usage for the current month.
 */
export async function incrementUsage(
  db: Pool,
  workspaceId: string,
  inputTokens: number,
  outputTokens: number
): Promise<AIUsage> {
  const monthStart = getCurrentMonthStart();

  const result = await db.query<AIUsage>(
    `
    INSERT INTO ai_usage (workspace_id, month, input_tokens_used, output_tokens_used, request_count)
    VALUES ($1, $2, $3, $4, 1)
    ON CONFLICT (workspace_id, month)
    DO UPDATE SET
      input_tokens_used = ai_usage.input_tokens_used + EXCLUDED.input_tokens_used,
      output_tokens_used = ai_usage.output_tokens_used + EXCLUDED.output_tokens_used,
      request_count = ai_usage.request_count + 1
    RETURNING id, workspace_id, month, input_tokens_used, output_tokens_used, request_count
    `,
    [workspaceId, monthStart, inputTokens, outputTokens]
  );

  return result.rows[0]!;
}

/**
 * Check if workspace has exceeded their monthly token limit.
 */
export async function checkUsageLimit(
  db: Pool,
  workspaceId: string,
  defaultLimit: number
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const usage = await getCurrentUsage(db, workspaceId);

  // Get workspace settings for custom limit
  const settingsResult = await db.query<{ monthly_token_limit: number | null }>(
    `
    SELECT monthly_token_limit FROM ai_settings WHERE workspace_id = $1
    `,
    [workspaceId]
  );

  const limit = settingsResult.rows[0]?.monthly_token_limit || defaultLimit;
  const used = Number(usage.input_tokens_used) + Number(usage.output_tokens_used);

  return {
    allowed: used < limit,
    used,
    limit,
  };
}
