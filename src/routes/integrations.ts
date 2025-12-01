import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { IntegrationService } from '../services/integrationService.js';
import { WorkspaceService } from '../services/workspaceService.js';
import type { GitHubConfig, GitHubCredentials, JiraConfig, JiraCredentials } from '../types/index.js';

// Validation schemas
const githubConfigSchema = z.object({
  workspaceId: z.string().uuid(),
  owner: z.string().min(1),
  repo: z.string().min(1),
  pat: z.string().min(1),
});

const jiraConfigSchema = z.object({
  workspaceId: z.string().uuid(),
  baseUrl: z.string().url(),
  projectKey: z.string().optional(),
  pat: z.string().min(1),
});

const integrationToggleSchema = z.object({
  workspaceId: z.string().uuid(),
  enabled: z.boolean(),
});

const taskLinkSchema = z.object({
  taskId: z.string().uuid(),
  provider: z.enum(['github', 'jira']),
  externalId: z.string().min(1),
  externalUrl: z.string().url(),
  title: z.string().optional(),
  status: z.string().optional(),
});

const githubSearchSchema = z.object({
  workspaceId: z.string().uuid(),
  query: z.string().min(1),
});

const jiraSearchSchema = z.object({
  workspaceId: z.string().uuid(),
  query: z.string().min(1),
  projectKey: z.string().optional(),
});

const linkGithubIssueSchema = z.object({
  taskId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  issueNumber: z.number().int().positive(),
});

const linkJiraIssueSchema = z.object({
  taskId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  issueKey: z.string().min(1), // e.g., "PROJ-123"
});

export default async function integrationRoutes(fastify: FastifyInstance) {
  const integrationService = new IntegrationService(fastify);
  const workspaceService = new WorkspaceService(fastify);

  // Helper to check admin access
  async function checkAdminAccess(
    workspaceId: string,
    userId: string,
    reply: FastifyReply
  ): Promise<boolean> {
    const role = await workspaceService.getUserRole(workspaceId, userId);
    if (role !== 'ADMIN') {
      reply.status(403).send({ error: 'Admin access required', code: 'FORBIDDEN' });
      return false;
    }
    return true;
  }

  // Helper to check workspace access (any role)
  async function checkWorkspaceAccess(
    workspaceId: string,
    userId: string,
    reply: FastifyReply
  ): Promise<boolean> {
    const role = await workspaceService.getUserRole(workspaceId, userId);
    if (!role) {
      reply.status(403).send({ error: 'Access denied', code: 'FORBIDDEN' });
      return false;
    }
    return true;
  }

  // ============ Integration Configuration ============

  // GET /api/integrations/:workspaceId - Get all integrations for workspace
  fastify.get<{ Params: { workspaceId: string } }>(
    '/:workspaceId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { workspaceId } = request.params;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      const integrations = await integrationService.getIntegrations(workspaceId);

      // Return sanitized integrations (no credentials)
      const result = {
        github: null as { configured: boolean; enabled: boolean; owner: string; repo: string } | null,
        jira: null as { configured: boolean; enabled: boolean; baseUrl: string } | null,
      };

      for (const integration of integrations) {
        if (integration.type === 'github' && integration.config) {
          const config = integration.config as GitHubConfig;
          result.github = {
            configured: true,
            enabled: integration.enabled,
            owner: config.owner,
            repo: config.repo,
          };
        } else if (integration.type === 'jira' && integration.config) {
          const config = integration.config as { baseUrl: string };
          result.jira = {
            configured: true,
            enabled: integration.enabled,
            baseUrl: config.baseUrl,
          };
        }
      }

      return reply.send(result);
    }
  );

  // ============ GitHub Integration ============

  // POST /api/integrations/github/setup - Configure GitHub integration
  fastify.post(
    '/github/setup',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = githubConfigSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId, owner, repo, pat } = parseResult.data;

      if (!(await checkAdminAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      const config: GitHubConfig = { owner, repo };
      const credentials: GitHubCredentials = { pat };

      // Test the connection first
      const testResult = await integrationService.testGitHubConnection(config, credentials);
      if (!testResult.success) {
        return reply.status(400).send({
          error: testResult.error || 'Failed to connect to GitHub',
          code: 'GITHUB_CONNECTION_FAILED',
        });
      }

      // Save the integration
      await integrationService.saveIntegration(workspaceId, 'github', config, credentials);

      return reply.status(201).send({
        success: true,
        repoName: testResult.repoName,
        repoUrl: testResult.repoUrl,
      });
    }
  );

  // POST /api/integrations/github/test - Test GitHub connection without saving
  fastify.post(
    '/github/test',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = githubConfigSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId, owner, repo, pat } = parseResult.data;

      if (!(await checkAdminAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      const config: GitHubConfig = { owner, repo };
      const credentials: GitHubCredentials = { pat };

      const testResult = await integrationService.testGitHubConnection(config, credentials);
      return reply.send(testResult);
    }
  );

  // DELETE /api/integrations/github/:workspaceId - Remove GitHub integration
  fastify.delete<{ Params: { workspaceId: string } }>(
    '/github/:workspaceId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { workspaceId } = request.params;

      if (!(await checkAdminAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      await integrationService.deleteIntegration(workspaceId, 'github');
      return reply.send({ success: true });
    }
  );

  // PATCH /api/integrations/github/:workspaceId/toggle - Enable/disable GitHub integration
  fastify.patch<{ Params: { workspaceId: string } }>(
    '/github/:workspaceId/toggle',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const parseResult = z.object({ enabled: z.boolean() }).safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
        });
      }

      if (!(await checkAdminAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      const updated = await integrationService.updateIntegrationEnabled(
        workspaceId,
        'github',
        parseResult.data.enabled
      );

      if (!updated) {
        return reply.status(404).send({
          error: 'GitHub integration not found',
          code: 'NOT_FOUND',
        });
      }

      return reply.send({ success: true, enabled: updated.enabled });
    }
  );

  // POST /api/integrations/github/search - Search GitHub issues
  fastify.post(
    '/github/search',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = githubSearchSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId, query } = parseResult.data;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      const integration = await integrationService.getIntegration(workspaceId, 'github');
      if (!integration || !integration.enabled || !integration.config || !integration.credentials) {
        return reply.status(400).send({
          error: 'GitHub integration not configured or disabled',
          code: 'INTEGRATION_NOT_CONFIGURED',
        });
      }

      const config = integration.config as GitHubConfig;
      const credentials = integration.credentials as GitHubCredentials;

      const issues = await integrationService.searchGitHubIssues(config, credentials, query);
      return reply.send({ issues });
    }
  );

  // ============ Jira Server Integration ============

  // POST /api/integrations/jira/setup - Configure Jira integration
  fastify.post(
    '/jira/setup',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = jiraConfigSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId, baseUrl, projectKey, pat } = parseResult.data;

      if (!(await checkAdminAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      const config: JiraConfig = { baseUrl, projectKey };
      const credentials: JiraCredentials = { pat, email: '' }; // email not needed for PAT

      // Test the connection first
      const testResult = await integrationService.testJiraConnection(config, credentials);
      if (!testResult.success) {
        return reply.status(400).send({
          error: testResult.error || 'Failed to connect to Jira',
          code: 'JIRA_CONNECTION_FAILED',
        });
      }

      // Save the integration
      await integrationService.saveIntegration(workspaceId, 'jira', config, credentials);

      return reply.status(201).send({
        success: true,
        serverTitle: testResult.serverTitle,
        baseUrl: testResult.baseUrl,
      });
    }
  );

  // POST /api/integrations/jira/test - Test Jira connection without saving
  fastify.post(
    '/jira/test',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = jiraConfigSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId, baseUrl, pat } = parseResult.data;

      if (!(await checkAdminAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      const config: JiraConfig = { baseUrl };
      const credentials: JiraCredentials = { pat, email: '' };

      const testResult = await integrationService.testJiraConnection(config, credentials);
      return reply.send(testResult);
    }
  );

  // DELETE /api/integrations/jira/:workspaceId - Remove Jira integration
  fastify.delete<{ Params: { workspaceId: string } }>(
    '/jira/:workspaceId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { workspaceId } = request.params;

      if (!(await checkAdminAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      await integrationService.deleteIntegration(workspaceId, 'jira');
      return reply.send({ success: true });
    }
  );

  // PATCH /api/integrations/jira/:workspaceId/toggle - Enable/disable Jira integration
  fastify.patch<{ Params: { workspaceId: string } }>(
    '/jira/:workspaceId/toggle',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const parseResult = z.object({ enabled: z.boolean() }).safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
        });
      }

      if (!(await checkAdminAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      const updated = await integrationService.updateIntegrationEnabled(
        workspaceId,
        'jira',
        parseResult.data.enabled
      );

      if (!updated) {
        return reply.status(404).send({
          error: 'Jira integration not found',
          code: 'NOT_FOUND',
        });
      }

      return reply.send({ success: true, enabled: updated.enabled });
    }
  );

  // POST /api/integrations/jira/search - Search Jira issues
  fastify.post(
    '/jira/search',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = jiraSearchSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { workspaceId, query, projectKey } = parseResult.data;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      const integration = await integrationService.getIntegration(workspaceId, 'jira');
      if (!integration || !integration.enabled || !integration.config || !integration.credentials) {
        return reply.status(400).send({
          error: 'Jira integration not configured or disabled',
          code: 'INTEGRATION_NOT_CONFIGURED',
        });
      }

      const config = integration.config as JiraConfig;
      const credentials = integration.credentials as JiraCredentials;

      const issues = await integrationService.searchJiraIssues(
        config,
        credentials,
        query,
        projectKey || config.projectKey
      );
      return reply.send({ issues });
    }
  );

  // POST /api/integrations/links/jira - Link a Jira issue to a task
  fastify.post(
    '/links/jira',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = linkJiraIssueSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { taskId, workspaceId, issueKey } = parseResult.data;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      // Get integration
      const integration = await integrationService.getIntegration(workspaceId, 'jira');
      if (!integration || !integration.enabled || !integration.config || !integration.credentials) {
        return reply.status(400).send({
          error: 'Jira integration not configured or disabled',
          code: 'INTEGRATION_NOT_CONFIGURED',
        });
      }

      const config = integration.config as JiraConfig;
      const credentials = integration.credentials as JiraCredentials;

      // Fetch the issue from Jira
      const issue = await integrationService.fetchJiraIssue(config, credentials, issueKey);
      if (!issue) {
        return reply.status(404).send({
          error: `Jira issue ${issueKey} not found`,
          code: 'NOT_FOUND',
        });
      }

      // Create the link
      const link = await integrationService.addTaskLink(
        taskId,
        'jira',
        issue.key,
        integrationService.getJiraIssueUrl(config.baseUrl, issue.key),
        issue.fields.summary,
        integrationService.getJiraStatusCategory(issue)
      );

      return reply.status(201).send({ link, issue });
    }
  );

  // ============ Task External Links ============

  // GET /api/integrations/links/:taskId - Get all external links for a task
  fastify.get<{ Params: { taskId: string }; Querystring: { workspaceId: string } }>(
    '/links/:taskId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { taskId } = request.params;
      const { workspaceId } = request.query;

      if (!workspaceId) {
        return reply.status(400).send({
          error: 'workspaceId query parameter required',
          code: 'INVALID_INPUT',
        });
      }

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      const links = await integrationService.getTaskLinks(taskId);
      return reply.send({ links });
    }
  );

  // POST /api/integrations/links/github - Link a GitHub issue to a task
  fastify.post(
    '/links/github',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = linkGithubIssueSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { taskId, workspaceId, issueNumber } = parseResult.data;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      // Get integration
      const integration = await integrationService.getIntegration(workspaceId, 'github');
      if (!integration || !integration.enabled || !integration.config || !integration.credentials) {
        return reply.status(400).send({
          error: 'GitHub integration not configured or disabled',
          code: 'INTEGRATION_NOT_CONFIGURED',
        });
      }

      const config = integration.config as GitHubConfig;
      const credentials = integration.credentials as GitHubCredentials;

      // Fetch the issue from GitHub
      const issue = await integrationService.fetchGitHubIssue(config, credentials, issueNumber);
      if (!issue) {
        return reply.status(404).send({
          error: `GitHub issue #${issueNumber} not found`,
          code: 'NOT_FOUND',
        });
      }

      // Create the link
      const link = await integrationService.addTaskLink(
        taskId,
        'github',
        String(issue.number),
        issue.html_url,
        issue.title,
        issue.state
      );

      return reply.status(201).send({ link, issue });
    }
  );

  // POST /api/integrations/links - Add a manual external link
  fastify.post(
    '/links',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = taskLinkSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { taskId, provider, externalId, externalUrl, title, status } = parseResult.data;

      // We need workspaceId to verify access - get it from the task
      // For now, allow any authenticated user (access check happens at task level)
      const link = await integrationService.addTaskLink(
        taskId,
        provider,
        externalId,
        externalUrl,
        title,
        status
      );

      return reply.status(201).send({ link });
    }
  );

  // DELETE /api/integrations/links/:taskId/:linkId - Remove an external link
  fastify.delete<{ Params: { taskId: string; linkId: string }; Querystring: { workspaceId: string } }>(
    '/links/:taskId/:linkId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { taskId, linkId } = request.params;
      const { workspaceId } = request.query;

      if (!workspaceId) {
        return reply.status(400).send({
          error: 'workspaceId query parameter required',
          code: 'INVALID_INPUT',
        });
      }

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      const deleted = await integrationService.removeTaskLink(taskId, linkId);
      if (!deleted) {
        return reply.status(404).send({
          error: 'Link not found',
          code: 'NOT_FOUND',
        });
      }

      return reply.send({ success: true });
    }
  );

  // POST /api/integrations/links/:taskId/sync - Sync all external links for a task
  fastify.post<{ Params: { taskId: string } }>(
    '/links/:taskId/sync',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { taskId } = request.params;
      const parseResult = z.object({ workspaceId: z.string().uuid() }).safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
        });
      }

      const { workspaceId } = parseResult.data;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      const links = await integrationService.syncAllTaskLinks(taskId, workspaceId);
      return reply.send({ links });
    }
  );

  // POST /api/integrations/links/bulk - Get links for multiple tasks
  fastify.post(
    '/links/bulk',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = z.object({
        workspaceId: z.string().uuid(),
        taskIds: z.array(z.string().uuid()),
      }).safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
        });
      }

      const { workspaceId, taskIds } = parseResult.data;

      if (!(await checkWorkspaceAccess(workspaceId, request.user.id, reply))) {
        return;
      }

      const links = await integrationService.getTasksLinks(taskIds);

      // Group by task_id
      const linksByTask: Record<string, typeof links> = {};
      for (const link of links) {
        if (!linksByTask[link.task_id]) {
          linksByTask[link.task_id] = [];
        }
        linksByTask[link.task_id].push(link);
      }

      return reply.send({ linksByTask });
    }
  );
}
