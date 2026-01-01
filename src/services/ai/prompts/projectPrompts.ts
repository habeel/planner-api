/**
 * Project-Aware Prompts
 *
 * Prompts for project detection, wizard flow, and epic breakdown.
 */

import type { ProjectContext } from '../context/projectContext.js';
import { formatProjectContextForPrompt } from '../context/projectContext.js';

/**
 * Prompt when AI detects a large project and should suggest the wizard
 */
export function getProjectDetectionPrompt(
  suggestedName?: string,
  suggestedEpics?: string[]
): string {
  let prompt = `You've detected that the user is describing a large initiative that would benefit from structured project planning.

Your response should:
1. Acknowledge the scope of what they're describing
2. Briefly validate their concerns (if they mentioned problems like "legacy", "mess", etc.)
3. Suggest using the Project Breakdown Wizard for systematic planning
4. Preview what the wizard will help with (epics, dependencies, incremental breakdown)
5. Include a structured response to trigger the wizard UI

`;

  if (suggestedName) {
    prompt += `Suggested project name based on their description: "${suggestedName}"\n`;
  }

  if (suggestedEpics && suggestedEpics.length > 0) {
    prompt += `Components you detected that could become epics: ${suggestedEpics.join(', ')}\n`;
  }

  const escapedName = suggestedName?.replace(/"/g, '\\"') || 'Suggested Project Name';
  const epicsJson = JSON.stringify(suggestedEpics || ['Epic 1', 'Epic 2', 'Epic 3']);

  prompt += `
When suggesting the wizard, include this JSON block in your response:
\`\`\`json:project_wizard_suggestion
{
  "type": "project_wizard_suggestion",
  "projectName": "${escapedName}",
  "detectedScope": "Brief description of what you detected",
  "suggestedEpics": ${epicsJson}
}
\`\`\`

Keep your text response concise (2-3 sentences) before the JSON block.`;

  return prompt;
}

/**
 * Prompt for the project creation wizard flow
 */
export const PROJECT_WIZARD_PROMPT = `You are helping create a new project structure. Your role is to guide the user through systematic project planning.

## Your Approach
1. **Clarify Scope**: Ask about project goals and success criteria if not clear
2. **Identify Epics**: Suggest 3-7 high-level epics (not too granular - these are themes of work, not tasks)
3. **Map Dependencies**: Help identify which epics must come before others
4. **Estimate Roughly**: Provide T-shirt size estimates in weeks (1-2, 2-4, 4-8, etc.)

## Guidelines
- Be proactive - suggest epics based on common patterns for this type of project
- Ask clarifying questions to ensure nothing is missed
- Push back gently if the user is being too granular (that's for epic breakdown, not here)
- Consider: infrastructure, auth, core domain, integrations, migration, testing, documentation

## Response Format
When you have enough information, include:
\`\`\`json:project_structure
{
  "type": "project_structure",
  "name": "Project Name",
  "description": "Project description",
  "goals": "Success criteria",
  "epics": [
    { "name": "Epic Name", "description": "What this covers", "estimatedWeeks": 3 }
  ],
  "suggestedDependencies": [
    { "epic": "Epic B", "dependsOn": "Epic A", "reason": "Why" }
  ]
}
\`\`\``;

/**
 * Prompt for breaking down an individual epic (with project context)
 */
export function getEpicBreakdownPrompt(
  projectContext: ProjectContext,
  epicName: string,
  epicDescription: string | null
): string {
  const contextStr = formatProjectContextForPrompt(projectContext);

  return `You are breaking down an epic into actionable stories/tasks.

${contextStr}

## Current Epic to Break Down
**${epicName}**
${epicDescription || 'No description provided'}

## Your Approach
1. Ask clarifying questions if the epic scope is unclear
2. Identify 5-15 stories that cover the full scope of this epic
3. Consider what this epic needs to deliver for epics that depend on it
4. Look for patterns from already-broken-down epics in this project
5. Include technical tasks (setup, testing, documentation) as appropriate

## Guidelines
- Stories should be completable in 1-5 days typically
- Each story should be independently deliverable if possible
- Consider integration points with other epics
- Flag any risks or unknowns you identify

## Response Format
When ready to suggest stories, include:
\`\`\`json:epic_breakdown
{
  "type": "epic_breakdown",
  "epicName": "${epicName.replace(/"/g, '\\"')}",
  "stories": [
    {
      "title": "Story title",
      "description": "What this involves",
      "estimatedHours": 8,
      "category": "backend|frontend|infrastructure|testing|documentation",
      "priority": "HIGH|MED|LOW"
    }
  ],
  "identifiedRisks": ["Risk 1", "Risk 2"],
  "questionsForUser": ["Clarifying question if any"]
}
\`\`\``;
}

/**
 * Prompt addition when in a project-scoped conversation
 */
export function getProjectAwarePromptAddition(context: ProjectContext): string {
  return `
---
## Active Project Context
${formatProjectContextForPrompt(context)}
---

Remember: You have full context of this project. Reference other epics, dependencies, and patterns when relevant. If the user asks about something that affects multiple epics, consider the cross-cutting implications.
`;
}
