import type { FastifyInstance } from 'fastify';
import type { TimeEntry } from '../types/index.js';

export interface CreateTimeEntryInput {
  task_id: string;
  user_id: string;
  date: string;
  hours: number;
  notes?: string;
}

export interface UpdateTimeEntryInput {
  date?: string;
  hours?: number;
  notes?: string | null;
}

export interface TimeEntryFilters {
  taskId?: string;
  userId?: string;
  from?: string;
  to?: string;
}

export interface TimeEntrySummary {
  task_id: string;
  total_hours: number;
  entry_count: number;
}

export class TimeEntryService {
  constructor(private fastify: FastifyInstance) {}

  async create(input: CreateTimeEntryInput): Promise<TimeEntry> {
    const result = await this.fastify.db.query<TimeEntry>(
      `INSERT INTO time_entries (task_id, user_id, date, hours, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.task_id, input.user_id, input.date, input.hours, input.notes || null]
    );
    return result.rows[0]!;
  }

  async getById(id: string): Promise<TimeEntry | null> {
    const result = await this.fastify.db.query<TimeEntry>(
      `SELECT * FROM time_entries WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  async update(id: string, input: UpdateTimeEntryInput): Promise<TimeEntry | null> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.date !== undefined) {
      updates.push(`date = $${paramIndex++}`);
      values.push(input.date);
    }
    if (input.hours !== undefined) {
      updates.push(`hours = $${paramIndex++}`);
      values.push(input.hours);
    }
    if (input.notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      values.push(input.notes);
    }

    if (updates.length === 0) {
      return this.getById(id);
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await this.fastify.db.query<TimeEntry>(
      `UPDATE time_entries SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.fastify.db.query(
      `DELETE FROM time_entries WHERE id = $1`,
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listByTask(taskId: string): Promise<TimeEntry[]> {
    const result = await this.fastify.db.query<TimeEntry>(
      `SELECT * FROM time_entries
       WHERE task_id = $1
       ORDER BY date DESC, created_at DESC`,
      [taskId]
    );
    return result.rows;
  }

  async listByUser(userId: string, from?: string, to?: string): Promise<TimeEntry[]> {
    let query = `SELECT * FROM time_entries WHERE user_id = $1`;
    const values: unknown[] = [userId];
    let paramIndex = 2;

    if (from && to) {
      query += ` AND date BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
      values.push(from, to);
    }

    query += ` ORDER BY date DESC, created_at DESC`;

    const result = await this.fastify.db.query<TimeEntry>(query, values);
    return result.rows;
  }

  async getTotalHoursForTask(taskId: string): Promise<number> {
    const result = await this.fastify.db.query<{ total: string }>(
      `SELECT COALESCE(SUM(hours), 0) as total
       FROM time_entries
       WHERE task_id = $1`,
      [taskId]
    );
    return parseFloat(result.rows[0]?.total || '0');
  }

  async getSummaryForTasks(taskIds: string[]): Promise<TimeEntrySummary[]> {
    if (taskIds.length === 0) return [];

    const placeholders = taskIds.map((_, i) => `$${i + 1}`).join(', ');
    const result = await this.fastify.db.query<TimeEntrySummary>(
      `SELECT task_id, COALESCE(SUM(hours), 0)::numeric as total_hours, COUNT(*)::integer as entry_count
       FROM time_entries
       WHERE task_id IN (${placeholders})
       GROUP BY task_id`,
      taskIds
    );
    return result.rows;
  }

  async getUserHoursForDateRange(
    userId: string,
    from: string,
    to: string
  ): Promise<{ date: string; hours: number }[]> {
    const result = await this.fastify.db.query<{ date: string; hours: string }>(
      `SELECT date::text, SUM(hours) as hours
       FROM time_entries
       WHERE user_id = $1 AND date BETWEEN $2 AND $3
       GROUP BY date
       ORDER BY date`,
      [userId, from, to]
    );
    return result.rows.map((r) => ({ date: r.date, hours: parseFloat(r.hours) }));
  }
}
