import type { Pool } from 'pg';

export interface WorkspaceSummary {
  workspaceName: string;
  teamSize: number;
  totalTasks: number;
  backlogCount: number;
  currentSprintTasks: number;
  teamCapacitySummary: string;
  upcomingDeadlines: number;
  overloadedMembers: string[];
}

export interface TeamMemberCapacity {
  userId: string;
  name: string;
  email: string;
  capacityHours: number;
  allocatedHours: number;
  availableHours: number;
}

export interface TaskSummary {
  id: string;
  title: string;
  status: string;
  priority: string;
  estimatedHours: number;
  assigneeName: string | null;
  assigneeId: string | null;
  startDate: string | null;
  dueDate: string | null;
}

export interface TimeOffEntry {
  userId: string;
  userName: string;
  dateFrom: string;
  dateTo: string;
  type: string;
}

export interface DetailedContext {
  tasks?: TaskSummary[];
  teamCapacity?: TeamMemberCapacity[];
  timeOff?: TimeOffEntry[];
}

export interface WorkspaceContext {
  summary: WorkspaceSummary;
  detailed?: DetailedContext;
}

export type ContextLevel = 'minimal' | 'scheduling' | 'backlog' | 'full';

export async function buildContext(
  db: Pool,
  workspaceId: string,
  includeDetails: ContextLevel
): Promise<WorkspaceContext> {
  const summary = await buildWorkspaceSummary(db, workspaceId);

  if (includeDetails === 'minimal') {
    return { summary };
  }

  const detailed: DetailedContext = {};

  if (includeDetails === 'scheduling' || includeDetails === 'full') {
    detailed.teamCapacity = await getTeamCapacity(db, workspaceId);
    detailed.tasks = await getCurrentWeekTasks(db, workspaceId);
    detailed.timeOff = await getUpcomingTimeOff(db, workspaceId);
  }

  if (includeDetails === 'backlog' || includeDetails === 'full') {
    const backlogTasks = await getBacklogTasks(db, workspaceId, 50);
    detailed.tasks = detailed.tasks
      ? [...detailed.tasks, ...backlogTasks]
      : backlogTasks;
  }

  return { summary, detailed };
}

async function buildWorkspaceSummary(
  db: Pool,
  workspaceId: string
): Promise<WorkspaceSummary> {
  // Get workspace stats in a single query
  const statsResult = await db.query<{
    workspace_name: string;
    team_size: string;
    total_tasks: string;
    backlog_count: string;
    current_sprint_tasks: string;
    upcoming_deadlines: string;
  }>(
    `
    SELECT
      w.name as workspace_name,
      (SELECT COUNT(*) FROM user_workspace_roles WHERE workspace_id = $1) as team_size,
      (SELECT COUNT(*) FROM tasks WHERE workspace_id = $1) as total_tasks,
      (SELECT COUNT(*) FROM tasks WHERE workspace_id = $1 AND status = 'BACKLOG') as backlog_count,
      (SELECT COUNT(*) FROM tasks WHERE workspace_id = $1
        AND start_date >= date_trunc('week', CURRENT_DATE)
        AND start_date < date_trunc('week', CURRENT_DATE) + interval '7 days') as current_sprint_tasks,
      (SELECT COUNT(*) FROM tasks WHERE workspace_id = $1
        AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + interval '7 days') as upcoming_deadlines
    FROM workspaces w
    WHERE w.id = $1
    `,
    [workspaceId]
  );

  const stats = statsResult.rows[0];
  if (!stats) {
    throw new Error('Workspace not found');
  }

  // Get overloaded team members
  const overloadedResult = await db.query<{ name: string }>(
    `
    SELECT u.name
    FROM users u
    JOIN user_workspace_roles uwr ON u.id = uwr.user_id
    WHERE uwr.workspace_id = $1
    AND (
      SELECT COALESCE(SUM(t.estimated_hours), 0)
      FROM tasks t
      WHERE t.assigned_to_user_id = u.id
      AND t.workspace_id = $1
      AND t.start_date >= date_trunc('week', CURRENT_DATE)
      AND t.start_date < date_trunc('week', CURRENT_DATE) + interval '7 days'
    ) > u.capacity_week_hours
    `,
    [workspaceId]
  );

  const teamSize = parseInt(stats.team_size, 10);
  const overloadedCount = overloadedResult.rows.length;

  return {
    workspaceName: stats.workspace_name,
    teamSize,
    totalTasks: parseInt(stats.total_tasks, 10),
    backlogCount: parseInt(stats.backlog_count, 10),
    currentSprintTasks: parseInt(stats.current_sprint_tasks, 10),
    upcomingDeadlines: parseInt(stats.upcoming_deadlines, 10),
    teamCapacitySummary: `${teamSize - overloadedCount}/${teamSize} team members have availability`,
    overloadedMembers: overloadedResult.rows.map((r) => r.name || 'Unknown'),
  };
}

export async function getTeamCapacity(
  db: Pool,
  workspaceId: string
): Promise<TeamMemberCapacity[]> {
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
    ORDER BY u.name
    `,
    [workspaceId]
  );

  return result.rows.map((row) => {
    const allocated = parseFloat(row.allocated_hours);
    return {
      userId: row.user_id,
      name: row.name || row.email,
      email: row.email,
      capacityHours: row.capacity_hours,
      allocatedHours: allocated,
      availableHours: Math.max(0, row.capacity_hours - allocated),
    };
  });
}

export async function getCurrentWeekTasks(
  db: Pool,
  workspaceId: string
): Promise<TaskSummary[]> {
  const result = await db.query<{
    id: string;
    title: string;
    status: string;
    priority: string;
    estimated_hours: number;
    assignee_name: string | null;
    assignee_id: string | null;
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
      u.name as assignee_name,
      t.assigned_to_user_id as assignee_id,
      t.start_date::text,
      t.due_date::text
    FROM tasks t
    LEFT JOIN users u ON t.assigned_to_user_id = u.id
    WHERE t.workspace_id = $1
    AND t.start_date >= date_trunc('week', CURRENT_DATE)
    AND t.start_date < date_trunc('week', CURRENT_DATE) + interval '7 days'
    ORDER BY t.priority DESC, t.start_date ASC
    `,
    [workspaceId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    estimatedHours: row.estimated_hours,
    assigneeName: row.assignee_name,
    assigneeId: row.assignee_id,
    startDate: row.start_date,
    dueDate: row.due_date,
  }));
}

export async function getBacklogTasks(
  db: Pool,
  workspaceId: string,
  limit: number = 50
): Promise<TaskSummary[]> {
  const result = await db.query<{
    id: string;
    title: string;
    status: string;
    priority: string;
    estimated_hours: number;
    assignee_name: string | null;
    assignee_id: string | null;
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
      u.name as assignee_name,
      t.assigned_to_user_id as assignee_id,
      t.start_date::text,
      t.due_date::text
    FROM tasks t
    LEFT JOIN users u ON t.assigned_to_user_id = u.id
    WHERE t.workspace_id = $1
    AND t.status = 'BACKLOG'
    ORDER BY t.priority DESC, t.created_at ASC
    LIMIT $2
    `,
    [workspaceId, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    estimatedHours: row.estimated_hours,
    assigneeName: row.assignee_name,
    assigneeId: row.assignee_id,
    startDate: row.start_date,
    dueDate: row.due_date,
  }));
}

export async function getUpcomingTimeOff(
  db: Pool,
  workspaceId: string
): Promise<TimeOffEntry[]> {
  const result = await db.query<{
    user_id: string;
    user_name: string;
    date_from: string;
    date_to: string;
    type: string;
  }>(
    `
    SELECT
      t.user_id,
      u.name as user_name,
      t.date_from::text,
      t.date_to::text,
      t.type
    FROM time_off t
    JOIN users u ON t.user_id = u.id
    JOIN user_workspace_roles uwr ON u.id = uwr.user_id
    WHERE uwr.workspace_id = $1
    AND t.date_to >= CURRENT_DATE
    AND t.date_from <= CURRENT_DATE + interval '30 days'
    ORDER BY t.date_from ASC
    `,
    [workspaceId]
  );

  return result.rows.map((row) => ({
    userId: row.user_id,
    userName: row.user_name || 'Unknown',
    dateFrom: row.date_from,
    dateTo: row.date_to,
    type: row.type,
  }));
}
