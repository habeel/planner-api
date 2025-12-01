import type { FastifyInstance } from 'fastify';
import type { Task, UserCapacity, WeekPlanningResponse } from '../types/index.js';
import { getWeekRange, getMonthRange } from '../utils/date.js';

export class PlanningService {
  constructor(private fastify: FastifyInstance) {}

  async getWeekPlanning(workspaceId: string, weekStart: string): Promise<WeekPlanningResponse> {
    const { start, end } = getWeekRange(weekStart);
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    // Get all users in workspace with their capacity
    const usersResult = await this.fastify.db.query<{
      id: string;
      email: string;
      name: string | null;
      capacity_week_hours: number;
    }>(
      `SELECT u.id, u.email, u.name, u.capacity_week_hours
       FROM users u
       JOIN user_workspace_roles uwr ON uwr.user_id = u.id
       WHERE uwr.workspace_id = $1 AND u.is_active = true`,
      [workspaceId]
    );

    // Get tasks for the week (including unscheduled)
    const tasksResult = await this.fastify.db.query<Task>(
      `SELECT * FROM tasks
       WHERE workspace_id = $1
       AND (start_date BETWEEN $2 AND $3 OR start_date IS NULL)
       ORDER BY COALESCE(start_date, '9999-12-31'), priority DESC`,
      [workspaceId, startStr, endStr]
    );

    // Calculate planned hours per user
    const plannedHoursMap = new Map<string, number>();
    for (const task of tasksResult.rows) {
      if (task.assigned_to_user_id && task.start_date) {
        // Only count scheduled tasks
        const current = plannedHoursMap.get(task.assigned_to_user_id) || 0;
        plannedHoursMap.set(task.assigned_to_user_id, current + Number(task.estimated_hours));
      }
    }

    // Calculate time off for the week (reduce capacity)
    const timeOffResult = await this.fastify.db.query<{
      user_id: string;
      days_off: number;
    }>(
      `SELECT user_id,
       COUNT(DISTINCT d.day) as days_off
       FROM time_off t,
       generate_series(
         GREATEST(t.date_from::date, $2::date),
         LEAST(t.date_to::date, $3::date),
         '1 day'
       ) AS d(day)
       WHERE t.user_id IN (
         SELECT user_id FROM user_workspace_roles WHERE workspace_id = $1
       )
       AND t.date_from <= $3 AND t.date_to >= $2
       GROUP BY user_id`,
      [workspaceId, startStr, endStr]
    );

    const timeOffMap = new Map<string, number>();
    for (const row of timeOffResult.rows) {
      timeOffMap.set(row.user_id, row.days_off);
    }

    const users: UserCapacity[] = usersResult.rows.map(user => {
      const daysOff = timeOffMap.get(user.id) || 0;
      const workDays = 5 - daysOff; // Assuming 5-day work week
      const capacity_hours = Math.max(0, (user.capacity_week_hours / 5) * workDays);
      const planned_hours = plannedHoursMap.get(user.id) || 0;
      const remaining_hours = capacity_hours - planned_hours;

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        capacity_hours,
        planned_hours,
        remaining_hours,
        overloaded: remaining_hours < 0,
      };
    });

    return {
      users,
      tasks: tasksResult.rows,
    };
  }

  async getMonthPlanning(workspaceId: string, month: string): Promise<{
    weeks: Array<{
      weekStart: string;
      users: UserCapacity[];
    }>;
    tasks: Task[];
  }> {
    const { start, end } = getMonthRange(month);
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    // Get tasks for the month
    const tasksResult = await this.fastify.db.query<Task>(
      `SELECT * FROM tasks
       WHERE workspace_id = $1
       AND (start_date BETWEEN $2 AND $3 OR start_date IS NULL)
       ORDER BY COALESCE(start_date, '9999-12-31'), priority DESC`,
      [workspaceId, startStr, endStr]
    );

    // Calculate week starts in the month
    const weeks: Array<{ weekStart: string; users: UserCapacity[] }> = [];
    const currentDate = new Date(start);

    // Find first Monday
    while (currentDate.getDay() !== 1) {
      currentDate.setDate(currentDate.getDate() + 1);
    }

    while (currentDate <= end) {
      const weekStartStr = currentDate.toISOString().split('T')[0]!;
      const weekPlanning = await this.getWeekPlanning(workspaceId, weekStartStr);
      weeks.push({
        weekStart: weekStartStr,
        users: weekPlanning.users,
      });
      currentDate.setDate(currentDate.getDate() + 7);
    }

    return {
      weeks,
      tasks: tasksResult.rows,
    };
  }

  async autoSchedule(
    workspaceId: string,
    startDate: string,
    endDate: string,
    _strategy: string = 'greedy'
  ): Promise<{ proposal: Array<{ taskId: string; suggestedStartDate: string }> }> {
    // MVP stub - just return unscheduled tasks with suggested dates
    const result = await this.fastify.db.query<Task>(
      `SELECT * FROM tasks
       WHERE workspace_id = $1
       AND start_date IS NULL
       AND status != 'DONE'
       ORDER BY priority DESC, created_at`,
      [workspaceId]
    );

    const proposal = result.rows.map((task, index) => {
      const suggestedDate = new Date(startDate);
      suggestedDate.setDate(suggestedDate.getDate() + index);
      return {
        taskId: task.id,
        suggestedStartDate: suggestedDate.toISOString().split('T')[0]!,
      };
    });

    return { proposal };
  }
}
