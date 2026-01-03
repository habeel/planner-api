/**
 * Project Context Builder
 *
 * Builds comprehensive project context for AI conversations,
 * including epics, dependencies, and cross-epic patterns.
 */

import type { Pool } from 'pg';

export interface ProjectContext {
  project: {
    id: string;
    key: string;
    name: string;
    description: string | null;
    goals: string | null;
    status: string;
  };
  epics: Array<{
    id: string;
    key: string;
    name: string;
    description: string | null;
    status: string;
    storyCount: number;
    estimatedWeeks: number | null;
    dependsOn: string[]; // Keys of epics this depends on (e.g., "E-1")
    blockedBy: string[]; // Keys of epics blocking this (e.g., "E-2")
  }>;
  conversationHistory: Array<{
    summary: string;
    createdAt: Date;
  }>;
  crossEpicPatterns: string[]; // Things shared across epics
}

export async function buildProjectContext(
  db: Pool,
  projectId: string
): Promise<ProjectContext | null> {
  // Get project with epics
  const projectResult = await db.query(
    `SELECT p.*,
            json_agg(
              json_build_object(
                'id', e.id,
                'key', e.key,
                'name', e.name,
                'description', e.description,
                'status', e.status,
                'estimated_weeks', e.estimated_weeks,
                'sort_order', e.sort_order
              ) ORDER BY e.sort_order
            ) FILTER (WHERE e.id IS NOT NULL) as epics
     FROM projects p
     LEFT JOIN epics e ON e.project_id = p.id
     WHERE p.id = $1
     GROUP BY p.id`,
    [projectId]
  );

  if (projectResult.rows.length === 0) return null;

  const row = projectResult.rows[0];
  const epics = row.epics || [];

  // Get story counts for each epic
  const epicIds = epics.map((e: { id: string }) => e.id);
  let storyCounts = new Map<string, number>();

  if (epicIds.length > 0) {
    const storyCountsResult = await db.query(
      `SELECT epic_id, COUNT(*) as count
       FROM tasks
       WHERE epic_id = ANY($1::uuid[])
       GROUP BY epic_id`,
      [epicIds]
    );

    storyCounts = new Map(
      storyCountsResult.rows.map((r: { epic_id: string; count: string }) => [
        r.epic_id,
        parseInt(r.count, 10),
      ])
    );
  }

  // Get dependencies - using keys instead of names for AI PM
  let dependencies = new Map<string, string[]>();
  let blockedBy = new Map<string, string[]>();

  if (epicIds.length > 0) {
    const depsResult = await db.query(
      `SELECT ed.epic_id, ed.depends_on_epic_id, e1.key as epic_key, e2.key as depends_on_key
       FROM epic_dependencies ed
       JOIN epics e1 ON e1.id = ed.epic_id
       JOIN epics e2 ON e2.id = ed.depends_on_epic_id
       WHERE ed.epic_id = ANY($1::uuid[])`,
      [epicIds]
    );

    for (const dep of depsResult.rows) {
      if (!dependencies.has(dep.epic_key)) {
        dependencies.set(dep.epic_key, []);
      }
      dependencies.get(dep.epic_key)!.push(dep.depends_on_key);

      if (!blockedBy.has(dep.depends_on_key)) {
        blockedBy.set(dep.depends_on_key, []);
      }
      blockedBy.get(dep.depends_on_key)!.push(dep.epic_key);
    }
  }

  // Get previous conversation summaries
  const conversationsResult = await db.query(
    `SELECT title, created_at
     FROM ai_conversations
     WHERE project_id = $1 AND is_archived = false
     ORDER BY created_at DESC
     LIMIT 5`,
    [projectId]
  );

  // Extract cross-epic patterns from broken-down epics
  const crossEpicPatterns = await extractCrossEpicPatterns(db, epics);

  return {
    project: {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      goals: row.goals,
      status: row.status,
    },
    epics: epics.map((e: {
      id: string;
      key: string;
      name: string;
      description: string | null;
      status: string;
      estimated_weeks: number | null;
    }) => ({
      id: e.id,
      key: e.key,
      name: e.name,
      description: e.description,
      status: e.status,
      storyCount: storyCounts.get(e.id) || 0,
      estimatedWeeks: e.estimated_weeks,
      dependsOn: dependencies.get(e.key) || [],
      blockedBy: blockedBy.get(e.key) || [],
    })),
    conversationHistory: conversationsResult.rows.map((r: { title: string; created_at: Date }) => ({
      summary: r.title || 'Untitled conversation',
      createdAt: r.created_at,
    })),
    crossEpicPatterns,
  };
}

async function extractCrossEpicPatterns(
  db: Pool,
  epics: Array<{ id: string; name: string; status: string }>
): Promise<string[]> {
  const patterns: string[] = [];

  // Look for common task patterns across epics
  const epicIds = epics
    .filter((e) => e.status === 'ready' || e.status === 'in_progress')
    .map((e) => e.id);

  if (epicIds.length === 0) return patterns;

  const tasksResult = await db.query(
    `SELECT title, epic_id FROM tasks WHERE epic_id = ANY($1::uuid[])`,
    [epicIds]
  );

  // Look for service/component patterns
  const servicePatterns = new Map<string, Set<string>>();
  const serviceRegex =
    /(?:create|implement|build)\s+([A-Z][a-zA-Z]+(?:Service|Manager|Handler|Client))/i;

  for (const task of tasksResult.rows) {
    const match = task.title.match(serviceRegex);
    if (match) {
      const serviceName = match[1];
      if (!servicePatterns.has(serviceName)) {
        servicePatterns.set(serviceName, new Set());
      }
      const epicName = epics.find((e) => e.id === task.epic_id)?.name;
      if (epicName) {
        servicePatterns.get(serviceName)!.add(epicName);
      }
    }
  }

  // Add patterns that appear in multiple epics
  for (const [service, epicNames] of servicePatterns) {
    if (epicNames.size > 1) {
      patterns.push(
        `${service} (shared across: ${Array.from(epicNames).join(', ')})`
      );
    }
  }

  return patterns;
}

export function formatProjectContextForPrompt(context: ProjectContext): string {
  let prompt = `## Project: ${context.project.name} (${context.project.key})\n`;

  if (context.project.description) {
    prompt += `Description: ${context.project.description}\n`;
  }

  if (context.project.goals) {
    prompt += `Goals: ${context.project.goals}\n`;
  }

  prompt += `Status: ${context.project.status}\n\n`;

  if (context.epics.length > 0) {
    prompt += `## Epics (${context.epics.length} total)\n`;
    prompt += `Use epic keys (E-1, E-2, etc.) when calling functions.\n`;

    const statusEmojis: Record<string, string> = {
      draft: '📝',
      ready_for_breakdown: '📋',
      breaking_down: '🔄',
      ready: '✅',
      in_progress: '🚧',
      done: '✓',
    };

    for (const epic of context.epics) {
      const statusEmoji = statusEmojis[epic.status] || '•';

      // Use key instead of UUID for easy AI reference
      prompt += `\n${statusEmoji} **${epic.name}** (${epic.key}) - ${epic.status}`;

      if (epic.storyCount > 0) {
        prompt += ` - ${epic.storyCount} stories`;
      }

      if (epic.estimatedWeeks) {
        prompt += ` - ~${epic.estimatedWeeks} weeks`;
      }

      if (epic.description) {
        prompt += `\n   ${epic.description}`;
      }

      if (epic.dependsOn.length > 0) {
        prompt += `\n   ⬅ Depends on: ${epic.dependsOn.join(', ')}`;
      }

      if (epic.blockedBy.length > 0) {
        prompt += `\n   ➡ Blocks: ${epic.blockedBy.join(', ')}`;
      }
    }
  }

  if (context.crossEpicPatterns.length > 0) {
    prompt += `\n\n## Shared Components\n`;
    for (const pattern of context.crossEpicPatterns) {
      prompt += `- ${pattern}\n`;
    }
  }

  if (context.conversationHistory.length > 0) {
    prompt += `\n\n## Previous Conversations\n`;
    for (const conv of context.conversationHistory) {
      prompt += `- ${conv.summary}\n`;
    }
  }

  return prompt;
}
