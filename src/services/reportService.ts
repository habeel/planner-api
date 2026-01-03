import type { FastifyInstance } from 'fastify';

export interface UserTimeData {
  user_id: string;
  name: string | null;
  email: string;
  total_hours: number;
  entry_count: number;
}

export interface TaskTimeData {
  task_id: string;
  key: string;
  title: string;
  estimated_hours: number;
  logged_hours: number;
  status: string;
  variance: number;
}

export interface DailyTotal {
  date: string;
  total_hours: number;
}

export interface UtilizationData {
  user_id: string;
  name: string | null;
  email: string;
  capacity_hours: number;
  logged_hours: number;
  utilization_percent: number;
}

export interface TimeReportSummary {
  total_hours: number;
  total_tasks: number;
  total_users: number;
}

export interface TimeReportResponse {
  summary: TimeReportSummary;
  by_user: UserTimeData[];
  by_task: TaskTimeData[];
  daily: DailyTotal[];
  utilization: UtilizationData[];
}

export class ReportService {
  constructor(private fastify: FastifyInstance) {}

  async getTimeReport(
    workspaceId: string,
    from: string,
    to: string
  ): Promise<TimeReportResponse> {
    // Get hours by user
    const userHoursResult = await this.fastify.db.query<{
      user_id: string;
      name: string | null;
      email: string;
      total_hours: string;
      entry_count: string;
    }>(
      `SELECT
        te.user_id,
        u.name,
        u.email,
        COALESCE(SUM(te.hours), 0) as total_hours,
        COUNT(*)::integer as entry_count
      FROM time_entries te
      JOIN users u ON te.user_id = u.id
      JOIN tasks t ON te.task_id = t.id
      WHERE t.workspace_id = $1 AND te.date BETWEEN $2 AND $3
      GROUP BY te.user_id, u.name, u.email
      ORDER BY total_hours DESC`,
      [workspaceId, from, to]
    );

    const byUser: UserTimeData[] = userHoursResult.rows.map((row) => ({
      user_id: row.user_id,
      name: row.name,
      email: row.email,
      total_hours: parseFloat(row.total_hours),
      entry_count: parseInt(row.entry_count, 10),
    }));

    // Get hours by task
    const taskHoursResult = await this.fastify.db.query<{
      task_id: string;
      key: string;
      title: string;
      estimated_hours: number;
      status: string;
      total_hours: string;
    }>(
      `SELECT
        t.id as task_id,
        t.key,
        t.title,
        t.estimated_hours,
        t.status,
        COALESCE(SUM(te.hours), 0) as total_hours
      FROM tasks t
      LEFT JOIN time_entries te ON te.task_id = t.id AND te.date BETWEEN $2 AND $3
      WHERE t.workspace_id = $1
      GROUP BY t.id, t.key, t.title, t.estimated_hours, t.status
      HAVING COALESCE(SUM(te.hours), 0) > 0
      ORDER BY total_hours DESC`,
      [workspaceId, from, to]
    );

    const byTask: TaskTimeData[] = taskHoursResult.rows.map((row) => {
      const loggedHours = parseFloat(row.total_hours);
      return {
        task_id: row.task_id,
        key: row.key,
        title: row.title,
        estimated_hours: row.estimated_hours,
        logged_hours: loggedHours,
        status: row.status,
        variance: loggedHours - row.estimated_hours,
      };
    });

    // Get daily totals for trend chart
    const dailyResult = await this.fastify.db.query<{
      date: string;
      total_hours: string;
    }>(
      `SELECT
        te.date::text,
        COALESCE(SUM(te.hours), 0) as total_hours
      FROM time_entries te
      JOIN tasks t ON te.task_id = t.id
      WHERE t.workspace_id = $1 AND te.date BETWEEN $2 AND $3
      GROUP BY te.date
      ORDER BY te.date`,
      [workspaceId, from, to]
    );

    const daily: DailyTotal[] = dailyResult.rows.map((row) => ({
      date: row.date,
      total_hours: parseFloat(row.total_hours),
    }));

    // Get utilization data
    const utilizationResult = await this.fastify.db.query<{
      user_id: string;
      name: string | null;
      email: string;
      capacity_week_hours: number;
      total_hours: string;
    }>(
      `SELECT
        u.id as user_id,
        u.name,
        u.email,
        u.capacity_week_hours,
        COALESCE(SUM(te.hours), 0) as total_hours
      FROM users u
      JOIN user_workspace_roles uwr ON u.id = uwr.user_id
      LEFT JOIN time_entries te ON te.user_id = u.id
        AND te.date BETWEEN $2 AND $3
        AND te.task_id IN (SELECT id FROM tasks WHERE workspace_id = $1)
      WHERE uwr.workspace_id = $1 AND u.is_active = true
      GROUP BY u.id, u.name, u.email, u.capacity_week_hours
      ORDER BY u.name`,
      [workspaceId, from, to]
    );

    // Calculate the number of weeks in the date range for capacity calculation
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const daysDiff = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const weeks = Math.max(1, daysDiff / 7);

    const utilization: UtilizationData[] = utilizationResult.rows.map((row) => {
      const loggedHours = parseFloat(row.total_hours);
      const capacityHours = row.capacity_week_hours * weeks;
      const utilizationPercent = capacityHours > 0
        ? Math.round((loggedHours / capacityHours) * 100)
        : 0;

      return {
        user_id: row.user_id,
        name: row.name,
        email: row.email,
        capacity_hours: Math.round(capacityHours),
        logged_hours: loggedHours,
        utilization_percent: utilizationPercent,
      };
    });

    // Calculate summary
    const totalHours = byUser.reduce((sum, u) => sum + u.total_hours, 0);
    const totalTasks = byTask.length;
    const totalUsers = byUser.length;

    return {
      summary: {
        total_hours: totalHours,
        total_tasks: totalTasks,
        total_users: totalUsers,
      },
      by_user: byUser,
      by_task: byTask,
      daily,
      utilization,
    };
  }
}
