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
  // Project & Epic functions
  {
    name: 'get_project_context',
    description:
      'Get full context for a project including all epics, their status, dependencies, and cross-epic patterns. Use this before providing advice about a project.',
    parameters: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The project key (P-1, P-2, etc.) - REQUIRED format',
          pattern: '^P-\\d+$',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'create_project_with_epics',
    description:
      'Create a new project with initial epic structure. Use after discussing project scope with user.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description: 'The workspace ID',
        },
        name: {
          type: 'string',
          description: 'Project name',
        },
        description: {
          type: 'string',
          description: 'Project description',
        },
        goals: {
          type: 'string',
          description: 'Success criteria and goals',
        },
        epics: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              estimatedWeeks: { type: 'number' },
            },
            required: ['name'],
          },
          description: 'Initial epics to create',
        },
      },
      required: ['workspaceId', 'name', 'epics'],
    },
  },
  {
    name: 'create_stories_for_epic',
    description:
      'Create stories/tasks for an epic. Use after breaking down an epic with the user.',
    parameters: {
      type: 'object',
      properties: {
        epicId: {
          type: 'string',
          description: 'The epic key (E-1, E-2, etc.) - REQUIRED format',
          pattern: '^E-\\d+$',
        },
        stories: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              estimatedHours: { type: 'number' },
              priority: { type: 'string', enum: ['LOW', 'MED', 'HIGH', 'CRITICAL'] },
            },
            required: ['title'],
          },
          description: 'Stories to create',
        },
      },
      required: ['epicId', 'stories'],
    },
  },
  {
    name: 'add_epic_dependency',
    description:
      'Add a dependency between two epics. Epic A depends on Epic B means A cannot start until B is done.',
    parameters: {
      type: 'object',
      properties: {
        epicId: {
          type: 'string',
          description: 'The epic key (E-1, E-2, etc.) that has the dependency - REQUIRED format',
          pattern: '^E-\\d+$',
        },
        dependsOnEpicId: {
          type: 'string',
          description: 'The epic key (E-1, E-2, etc.) that must be completed first - REQUIRED format',
          pattern: '^E-\\d+$',
        },
        type: {
          type: 'string',
          enum: ['blocks', 'related', 'informs'],
          description: 'Type of dependency',
        },
      },
      required: ['epicId', 'dependsOnEpicId'],
    },
  },
];
