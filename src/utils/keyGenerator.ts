import type { Pool } from 'pg';

export type EntityType = 'project' | 'epic' | 'task';

const ENTITY_PREFIXES: Record<EntityType, string> = {
  project: 'P',
  epic: 'E',
  task: 'T',
};

/**
 * Generate a human-readable key for an entity.
 * Keys are workspace-scoped and sequential per entity type.
 *
 * @example
 * generateKey(db, workspaceId, 'project') // Returns 'P-1', 'P-2', etc.
 * generateKey(db, workspaceId, 'epic')    // Returns 'E-1', 'E-2', etc.
 * generateKey(db, workspaceId, 'task')    // Returns 'T-1', 'T-2', etc.
 */
export async function generateKey(
  db: Pool,
  workspaceId: string,
  entityType: EntityType
): Promise<string> {
  const prefix = ENTITY_PREFIXES[entityType];

  const result = await db.query<{ get_next_key: number }>(
    'SELECT get_next_key($1, $2) as get_next_key',
    [workspaceId, entityType]
  );

  const num = result.rows[0]!.get_next_key;
  return `${prefix}-${num}`;
}

/**
 * Generate a key within a transaction (uses client instead of pool).
 * Use this when creating entities as part of a larger transaction.
 */
export async function generateKeyWithClient(
  client: { query: Pool['query'] },
  workspaceId: string,
  entityType: EntityType
): Promise<string> {
  const prefix = ENTITY_PREFIXES[entityType];

  const result = await client.query<{ get_next_key: number }>(
    'SELECT get_next_key($1, $2) as get_next_key',
    [workspaceId, entityType]
  );

  const num = result.rows[0]!.get_next_key;
  return `${prefix}-${num}`;
}
