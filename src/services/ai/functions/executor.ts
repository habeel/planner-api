import type { Pool } from 'pg';
import type { ToolCall, ToolMessage } from '../providers/base.js';
import {
  getTeamCapacity,
  getBacklogTasks,
  getCurrentWeekTasks,
  getUpcomingTimeOff,
  type TaskSummary,
  type TeamMemberCapacity,
} from '../context/builder.js';

export interface FunctionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Execute a function call requested by the AI and return the result as a tool message.
 */
export async function executeFunctionCall(
  db: Pool,
  workspaceId: string,
  toolCall: ToolCall
): Promise<ToolMessage> {
  const result = await executeFunction(db, workspaceId, toolCall.name, toolCall.arguments);

  return {
    role: 'tool',
    toolCallId: toolCall.id,
    content: JSON.stringify(result),
  };
}

/**
 * Execute a function by name with the given arguments.
 */
async function executeFunction(
  db: Pool,
  workspaceId: string,
  functionName: string,
  args: Record<string, unknown>
): Promise<FunctionResult> {
  try {
    switch (functionName) {
      case 'get_team_capacity':
        return await handleGetTeamCapacity(db, workspaceId, args);

      case 'get_backlog_tasks':
        return await handleGetBacklogTasks(db, workspaceId, args);

      case 'get_task_details':
        return await handleGetTaskDetails(db, workspaceId, args);

      case 'get_user_schedule':
        return await handleGetUserSchedule(db, workspaceId, args);

      case 'get_overloaded_users':
        return await handleGetOverloadedUsers(db, workspaceId, args);

      default:
        return {
          success: false,
          error: `Unknown function: ${functionName}`,
        };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Get team capacity for a specific week.
 */
async function handleGetTeamCapacity(
  db: Pool,
  workspaceId: string,
  args: Record<string, unknown>
): Promise<FunctionResult> {
  // Note: weekStart is currently not used as getTeamCapacity uses current week
  // This could be enhanced in the future to support custom week dates
  const capacity = await getTeamCapacity(db, workspaceId);

  return {
    success: true,
    data: {
      weekStart: args.weekStart || getCurrentWeekStart(),
      teamMembers: capacity,
      summary: {
        totalCapacity: capacity.reduce((sum, m) => sum + m.capacityHours, 0),
        totalAllocated: capacity.reduce((sum, m) => sum + m.allocatedHours, 0),
        totalAvailable: capacity.reduce((sum, m) => sum + m.availableHours, 0),
        overloadedCount: capacity.filter((m) => m.allocatedHours > m.capacityHours).length,
      },
    },
  };
}

/**
 * Get backlog tasks with optional filters.
 */
async function handleGetBacklogTasks(
  db: Pool,
  workspaceId: string,
  args: Record<string, unknown>
): Promise<FunctionResult> {
  const limit = typeof args.limit === 'number' ? Math.min(args.limit, 100) : 50;
  let tasks = await getBacklogTasks(db, workspaceId, limit);

  // Apply priority filter if specified
  if (typeof args.priority === 'string') {
    tasks = tasks.filter((t) => t.priority === args.priority);
  }

  // Apply assignee filter if specified
  if (typeof args.assigneeId === 'string') {
    tasks = tasks.filter((t) => t.assigneeId === args.assigneeId);
  }

  return {
    success: true,
    data: {
      tasks,
      totalCount: tasks.length,
    },
  };
}

/**
 * Get detailed information about specific tasks.
 */
async function handleGetTaskDetails(
  db: Pool,
  workspaceId: string,
  args: Record<string, unknown>
): Promise<FunctionResult> {
  const taskIds = args.taskIds as string[];

  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return {
      success: false,
      error: 'taskIds must be a non-empty array of strings',
    };
  }

  // Limit to 20 tasks to prevent abuse
  const limitedIds = taskIds.slice(0, 20);

  const result = await db.query<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    estimated_hours: number;
    assignee_name: string | null;
    assignee_id: string | null;
    start_date: string | null;
    due_date: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `
    SELECT
      t.id,
      t.title,
      t.description,
      t.status,
      t.priority,
      t.estimated_hours,
      u.name as assignee_name,
      t.assigned_to_user_id as assignee_id,
      t.start_date::text,
      t.due_date::text,
      t.created_at::text,
      t.updated_at::text
    FROM tasks t
    LEFT JOIN users u ON t.assigned_to_user_id = u.id
    WHERE t.workspace_id = $1 AND t.id = ANY($2::uuid[])
    `,
    [workspaceId, limitedIds]
  );

  // Get dependencies for these tasks
  const depsResult = await db.query<{
    task_id: string;
    depends_on_task_id: string;
    depends_on_title: string;
    type: string;
  }>(
    `
    SELECT
      td.task_id,
      td.depends_on_task_id,
      t.title as depends_on_title,
      td.type
    FROM task_dependencies td
    JOIN tasks t ON td.depends_on_task_id = t.id
    WHERE td.task_id = ANY($1::uuid[])
    `,
    [limitedIds]
  );

  const dependenciesMap = new Map<string, Array<{ id: string; title: string; type: string }>>();
  for (const dep of depsResult.rows) {
    if (!dependenciesMap.has(dep.task_id)) {
      dependenciesMap.set(dep.task_id, []);
    }
    dependenciesMap.get(dep.task_id)!.push({
      id: dep.depends_on_task_id,
      title: dep.depends_on_title,
      type: dep.type,
    });
  }

  const tasks = result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    estimatedHours: row.estimated_hours,
    assigneeName: row.assignee_name,
    assigneeId: row.assignee_id,
    startDate: row.start_date,
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dependencies: dependenciesMap.get(row.id) || [],
  }));

  return {
    success: true,
    data: { tasks },
  };
}

/**
 * Get a user's scheduled tasks and availability for a date range.
 */
async function handleGetUserSchedule(
  db: Pool,
  workspaceId: string,
  args: Record<string, unknown>
): Promise<FunctionResult> {
  const { userId, from, to } = args as { userId: string; from: string; to: string };

  if (!userId || !from || !to) {
    return {
      success: false,
      error: 'userId, from, and to are required parameters',
    };
  }

  // Get user info
  const userResult = await db.query<{
    id: string;
    name: string;
    email: string;
    capacity_week_hours: number;
  }>(
    `
    SELECT u.id, u.name, u.email, u.capacity_week_hours
    FROM users u
    JOIN user_workspace_roles uwr ON u.id = uwr.user_id
    WHERE u.id = $1 AND uwr.workspace_id = $2
    `,
    [userId, workspaceId]
  );

  if (userResult.rows.length === 0) {
    return {
      success: false,
      error: 'User not found in this workspace',
    };
  }

  const user = userResult.rows[0]!;

  // Get tasks in date range
  const tasksResult = await db.query<{
    id: string;
    title: string;
    status: string;
    priority: string;
    estimated_hours: number;
    start_date: string | null;
    due_date: string | null;
  }>(
    `
    SELECT
      t.id,
      t.title,
      t.status,
      t.priority,
      t.estimated_hours,
      t.start_date::text,
      t.due_date::text
    FROM tasks t
    WHERE t.workspace_id = $1
    AND t.assigned_to_user_id = $2
    AND (
      (t.start_date >= $3 AND t.start_date <= $4)
      OR (t.due_date >= $3 AND t.due_date <= $4)
      OR (t.start_date <= $3 AND t.due_date >= $4)
    )
    ORDER BY t.start_date ASC NULLS LAST
    `,
    [workspaceId, userId, from, to]
  );

  // Get time off in date range
  const timeOffResult = await db.query<{
    date_from: string;
    date_to: string;
    type: string;
  }>(
    `
    SELECT date_from::text, date_to::text, type
    FROM time_off
    WHERE user_id = $1
    AND date_to >= $2
    AND date_from <= $3
    `,
    [userId, from, to]
  );

  const totalAllocatedHours = tasksResult.rows.reduce((sum, t) => sum + t.estimated_hours, 0);

  return {
    success: true,
    data: {
      user: {
        id: user.id,
        name: user.name || user.email,
        email: user.email,
        capacityPerWeek: user.capacity_week_hours,
      },
      dateRange: { from, to },
      tasks: tasksResult.rows.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        estimatedHours: t.estimated_hours,
        startDate: t.start_date,
        dueDate: t.due_date,
      })),
      timeOff: timeOffResult.rows.map((t) => ({
        dateFrom: t.date_from,
        dateTo: t.date_to,
        type: t.type,
      })),
      summary: {
        totalTasks: tasksResult.rows.length,
        totalAllocatedHours,
        hasTimeOff: timeOffResult.rows.length > 0,
      },
    },
  };
}

/**
 * Get overloaded team members for a specific week.
 */
async function handleGetOverloadedUsers(
  db: Pool,
  workspaceId: string,
  args: Record<string, unknown>
): Promise<FunctionResult> {
  // Note: weekStart is currently not used as query uses current week
  const result = await db.query<{
    user_id: string;
    name: string;
    email: string;
    capacity_hours: number;
    allocated_hours: string;
  }>(
    `
    SELECT
      u.id as user_id,
      u.name,
      u.email,
      u.capacity_week_hours as capacity_hours,
      COALESCE(
        (SELECT SUM(t.estimated_hours)
         FROM tasks t
         WHERE t.assigned_to_user_id = u.id
         AND t.workspace_id = $1
         AND t.start_date >= date_trunc('week', CURRENT_DATE)
         AND t.start_date < date_trunc('week', CURRENT_DATE) + interval '7 days'),
        0
      ) as allocated_hours
    FROM users u
    JOIN user_workspace_roles uwr ON u.id = uwr.user_id
    WHERE uwr.workspace_id = $1
    HAVING COALESCE(
      (SELECT SUM(t.estimated_hours)
       FROM tasks t
       WHERE t.assigned_to_user_id = u.id
       AND t.workspace_id = $1
       AND t.start_date >= date_trunc('week', CURRENT_DATE)
       AND t.start_date < date_trunc('week', CURRENT_DATE) + interval '7 days'),
      0
    ) > u.capacity_week_hours
    ORDER BY u.name
    `,
    [workspaceId]
  );

  const overloadedUsers = result.rows.map((row) => {
    const allocated = parseFloat(row.allocated_hours);
    return {
      userId: row.user_id,
      name: row.name || row.email,
      email: row.email,
      capacityHours: row.capacity_hours,
      allocatedHours: allocated,
      overloadHours: allocated - row.capacity_hours,
      overloadPercentage: Math.round(((allocated - row.capacity_hours) / row.capacity_hours) * 100),
    };
  });

  return {
    success: true,
    data: {
      weekStart: args.weekStart || getCurrentWeekStart(),
      overloadedUsers,
      count: overloadedUsers.length,
    },
  };
}

/**
 * Get the start of the current week (Monday) in YYYY-MM-DD format.
 */
function getCurrentWeekStart(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust for Sunday
  const monday = new Date(now.setDate(diff));
  return monday.toISOString().split('T')[0]!;
}
