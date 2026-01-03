import type { Pool } from 'pg';

export type EntityType = 'project' | 'epic' | 'task';

// Key format patterns
const KEY_PATTERNS: Record<EntityType, RegExp> = {
  project: /^P-\d+$/i,
  epic: /^E-\d+$/i,
  task: /^T-\d+$/i,
};

// Table names for each entity type
const TABLE_NAMES: Record<EntityType, string> = {
  project: 'projects',
  epic: 'epics',
  task: 'tasks',
};

export interface ResolutionResult {
  success: boolean;
  id?: string;
  error?: string;
}

/**
 * Validate that a key matches the expected format.
 */
export function isValidKey(key: string, entityType: EntityType): boolean {
  return KEY_PATTERNS[entityType].test(key);
}

/**
 * Get the expected key format for an entity type.
 */
export function getExpectedKeyFormat(entityType: EntityType): string {
  const prefixes: Record<EntityType, string> = {
    project: 'P-N (e.g., P-1, P-2)',
    epic: 'E-N (e.g., E-1, E-2)',
    task: 'T-N (e.g., T-1, T-2)',
  };
  return prefixes[entityType];
}

/**
 * Resolve a human-readable key to a UUID.
 *
 * ONLY accepts keys in format P-N, E-N, T-N.
 * Does NOT accept UUIDs or entity names.
 *
 * @param db - Database pool
 * @param workspaceId - Workspace to search in
 * @param key - Human-readable key (e.g., "E-1", "P-3")
 * @param entityType - Type of entity to resolve
 * @returns Resolution result with UUID if found, or error message
 */
export async function resolveKeyToId(
  db: Pool,
  workspaceId: string,
  key: string,
  entityType: EntityType
): Promise<ResolutionResult> {
  // Normalize key to uppercase
  const normalizedKey = key.toUpperCase();

  // Validate key format
  if (!isValidKey(normalizedKey, entityType)) {
    return {
      success: false,
      error: `Invalid ${entityType} key format "${key}". Expected format: ${getExpectedKeyFormat(entityType)}`,
    };
  }

  // Query for the entity by key
  const tableName = TABLE_NAMES[entityType];
  const result = await db.query<{ id: string }>(
    `SELECT id FROM ${tableName} WHERE workspace_id = $1 AND UPPER(key) = $2`,
    [workspaceId, normalizedKey]
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      error: `${entityType.charAt(0).toUpperCase() + entityType.slice(1)} "${normalizedKey}" not found in this workspace`,
    };
  }

  return {
    success: true,
    id: result.rows[0]!.id,
  };
}

/**
 * Resolve multiple keys to UUIDs in a single query.
 * Useful for batch operations.
 */
export async function resolveKeysToIds(
  db: Pool,
  workspaceId: string,
  keys: string[],
  entityType: EntityType
): Promise<Map<string, ResolutionResult>> {
  const results = new Map<string, ResolutionResult>();

  // Validate all keys first
  const validKeys: string[] = [];
  for (const key of keys) {
    const normalizedKey = key.toUpperCase();
    if (!isValidKey(normalizedKey, entityType)) {
      results.set(key, {
        success: false,
        error: `Invalid ${entityType} key format "${key}". Expected format: ${getExpectedKeyFormat(entityType)}`,
      });
    } else {
      validKeys.push(normalizedKey);
    }
  }

  if (validKeys.length === 0) {
    return results;
  }

  // Query all valid keys at once
  const tableName = TABLE_NAMES[entityType];
  const placeholders = validKeys.map((_, i) => `$${i + 2}`).join(', ');
  const queryResult = await db.query<{ id: string; key: string }>(
    `SELECT id, UPPER(key) as key FROM ${tableName}
     WHERE workspace_id = $1 AND UPPER(key) IN (${placeholders})`,
    [workspaceId, ...validKeys]
  );

  // Map results
  const foundKeys = new Map(queryResult.rows.map((row) => [row.key, row.id]));

  for (const key of keys) {
    if (results.has(key)) continue; // Already has error

    const normalizedKey = key.toUpperCase();
    const id = foundKeys.get(normalizedKey);

    if (id) {
      results.set(key, { success: true, id });
    } else {
      results.set(key, {
        success: false,
        error: `${entityType.charAt(0).toUpperCase() + entityType.slice(1)} "${normalizedKey}" not found in this workspace`,
      });
    }
  }

  return results;
}
