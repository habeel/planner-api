import type { FunctionDefinition } from '../providers/base.js';

export const aiFunctions: FunctionDefinition[] = [
  {
    name: 'get_team_capacity',
    description:
      'Get detailed capacity information for all team members for a specific week, including their allocated hours and availability.',
    parameters: {
      type: 'object',
      properties: {
        weekStart: {
          type: 'string',
          description: 'Start date of the week in YYYY-MM-DD format',
        },
      },
      required: ['weekStart'],
    },
  },
  {
    name: 'get_backlog_tasks',
    description:
      'Get tasks from the backlog, optionally filtered by priority or assignee. Returns up to 50 tasks.',
    parameters: {
      type: 'object',
      properties: {
        priority: {
          type: 'string',
          enum: ['LOW', 'MED', 'HIGH', 'CRITICAL'],
          description: 'Filter by priority level',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of tasks to return (default: 50)',
        },
        assigneeId: {
          type: 'string',
          description: 'Filter by assigned user ID',
        },
      },
    },
  },
  {
    name: 'get_task_details',
    description:
      'Get detailed information about specific tasks by their IDs, including description, dependencies, and time entries.',
    parameters: {
      type: 'object',
      properties: {
        taskIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of task IDs to fetch details for',
        },
      },
      required: ['taskIds'],
    },
  },
  {
    name: 'get_user_schedule',
    description:
      "Get a specific user's scheduled tasks and availability for a date range.",
    parameters: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User ID to get schedule for',
        },
        from: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format',
        },
        to: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format',
        },
      },
      required: ['userId', 'from', 'to'],
    },
  },
  {
    name: 'get_overloaded_users',
    description:
      'Get a list of team members who are overloaded (allocated hours exceed capacity) for the current or specified week.',
    parameters: {
      type: 'object',
      properties: {
        weekStart: {
          type: 'string',
          description:
            'Start date of the week in YYYY-MM-DD format (defaults to current week)',
        },
      },
    },
  },
];
