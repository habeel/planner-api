import type { WorkspaceContext } from '../context/builder.js';

export function getSystemPrompt(context: WorkspaceContext): string {
  const { summary } = context;

  let prompt = `You are an AI Project Manager assistant for "${summary.workspaceName}".

Your role is to help team leads and admins with:
- Breaking down features into actionable tasks
- Planning sprints and scheduling work
- Identifying capacity issues and overloads
- Prioritizing and managing the backlog

## Current Workspace Status
- Team size: ${summary.teamSize} members
- Total tasks: ${summary.totalTasks}
- Backlog items: ${summary.backlogCount}
- Current sprint: ${summary.currentSprintTasks} tasks
- Upcoming deadlines (7 days): ${summary.upcomingDeadlines}
- Team availability: ${summary.teamCapacitySummary}
${
  summary.overloadedMembers.length > 0
    ? `- ⚠️ Overloaded team members: ${summary.overloadedMembers.join(', ')}`
    : '- No team members are currently overloaded'
}

## Guidelines
1. Always consider team capacity when suggesting task assignments
2. Provide realistic time estimates based on task complexity
3. Identify dependencies between tasks
4. Flag potential scheduling conflicts
5. Be concise but thorough in explanations

## Response Format
When suggesting tasks, you can include structured JSON in your response using this format:
\`\`\`json:task_suggestions
{
  "type": "task_suggestions",
  "tasks": [
    {
      "tempId": "temp-1",
      "title": "Task title",
      "description": "Task description",
      "estimatedHours": 4,
      "priority": "high",
      "category": "backend"
    }
  ]
}
\`\`\`

When analyzing team capacity, include:
\`\`\`json:capacity_overview
{
  "type": "capacity_overview",
  "period": { "start": "2024-01-15", "end": "2024-01-19" },
  "team": [
    {
      "userId": "uuid",
      "name": "Team Member",
      "capacity": 40,
      "allocated": 32,
      "available": 8,
      "status": "busy"
    }
  ]
}
\`\`\`

Priorities should be: low, medium, high, or critical.
Status should be: available, busy, or overloaded.`;

  // Add detailed context if available
  if (context.detailed) {
    if (context.detailed.teamCapacity && context.detailed.teamCapacity.length > 0) {
      prompt += `\n\n## Detailed Team Capacity (This Week)`;
      for (const member of context.detailed.teamCapacity) {
        const status =
          member.availableHours <= 0
            ? 'OVERLOADED'
            : member.availableHours < 8
              ? 'BUSY'
              : 'Available';
        prompt += `\n- ${member.name}: ${member.allocatedHours}/${member.capacityHours}h allocated (${member.availableHours}h available) - ${status}`;
      }
    }

    if (context.detailed.tasks && context.detailed.tasks.length > 0) {
      const scheduledTasks = context.detailed.tasks.filter((t) => t.startDate);
      const backlogTasks = context.detailed.tasks.filter((t) => !t.startDate);

      if (scheduledTasks.length > 0) {
        prompt += `\n\n## Scheduled Tasks (${scheduledTasks.length} tasks)`;
        for (const task of scheduledTasks.slice(0, 20)) {
          prompt += `\n- [${task.priority}] ${task.title} (${task.estimatedHours}h, ${task.assigneeName || 'Unassigned'})`;
        }
        if (scheduledTasks.length > 20) {
          prompt += `\n... and ${scheduledTasks.length - 20} more tasks`;
        }
      }

      if (backlogTasks.length > 0) {
        prompt += `\n\n## Backlog (${backlogTasks.length} items)`;
        for (const task of backlogTasks.slice(0, 15)) {
          prompt += `\n- [${task.priority}] ${task.title} (${task.estimatedHours}h)`;
        }
        if (backlogTasks.length > 15) {
          prompt += `\n... and ${backlogTasks.length - 15} more items`;
        }
      }
    }

    if (context.detailed.timeOff && context.detailed.timeOff.length > 0) {
      prompt += `\n\n## Upcoming Time Off`;
      for (const timeOff of context.detailed.timeOff) {
        prompt += `\n- ${timeOff.userName}: ${timeOff.dateFrom} to ${timeOff.dateTo} (${timeOff.type})`;
      }
    }
  }

  return prompt;
}

export function getConversationSummaryPrompt(): string {
  return `Summarize the following conversation concisely, preserving:
1. Key decisions made
2. Important context about tasks or planning
3. Any unresolved questions or action items
Keep the summary under 500 words.`;
}
