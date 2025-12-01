import type { FastifyInstance } from 'fastify';
import type {
  Integration,
  IntegrationType,
  GitHubConfig,
  GitHubCredentials,
  GitHubIssue,
  JiraConfig,
  JiraCredentials,
  JiraIssue,
  TaskExternalLink,
  ExternalLinkProvider,
} from '../types/index.js';

export interface SyncResult {
  imported: number;
  updated: number;
  errors: Array<{ message: string; item?: unknown }>;
}

export interface GitHubConnectionTest {
  success: boolean;
  error?: string;
  repoName?: string;
  repoUrl?: string;
}

export interface JiraConnectionTest {
  success: boolean;
  error?: string;
  serverTitle?: string;
  baseUrl?: string;
}

export class IntegrationService {
  constructor(private fastify: FastifyInstance) {}

  // ============ Integration CRUD ============

  async getIntegration(workspaceId: string, type: IntegrationType): Promise<Integration | null> {
    const result = await this.fastify.db.query<Integration>(
      `SELECT * FROM integrations WHERE workspace_id = $1 AND type = $2`,
      [workspaceId, type]
    );
    return result.rows[0] || null;
  }

  async getIntegrations(workspaceId: string): Promise<Integration[]> {
    const result = await this.fastify.db.query<Integration>(
      `SELECT * FROM integrations WHERE workspace_id = $1`,
      [workspaceId]
    );
    return result.rows;
  }

  async saveIntegration(
    workspaceId: string,
    type: IntegrationType,
    config: Record<string, unknown>,
    credentials: Record<string, unknown>
  ): Promise<Integration> {
    const result = await this.fastify.db.query<Integration>(
      `INSERT INTO integrations (workspace_id, type, config, credentials, enabled)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (workspace_id, type) DO UPDATE SET
         config = $3,
         credentials = $4,
         enabled = true
       RETURNING *`,
      [workspaceId, type, JSON.stringify(config), JSON.stringify(credentials)]
    );
    return result.rows[0]!;
  }

  async updateIntegrationEnabled(
    workspaceId: string,
    type: IntegrationType,
    enabled: boolean
  ): Promise<Integration | null> {
    const result = await this.fastify.db.query<Integration>(
      `UPDATE integrations SET enabled = $3 WHERE workspace_id = $1 AND type = $2 RETURNING *`,
      [workspaceId, type, enabled]
    );
    return result.rows[0] || null;
  }

  async deleteIntegration(workspaceId: string, type: IntegrationType): Promise<boolean> {
    const result = await this.fastify.db.query(
      `DELETE FROM integrations WHERE workspace_id = $1 AND type = $2`,
      [workspaceId, type]
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ============ GitHub Integration ============

  async testGitHubConnection(config: GitHubConfig, credentials: GitHubCredentials): Promise<GitHubConnectionTest> {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${config.owner}/${config.repo}`,
        {
          headers: {
            Authorization: `Bearer ${credentials.pat}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'Planner-App',
          },
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (response.status === 401) {
          return { success: false, error: 'Invalid GitHub token' };
        }
        if (response.status === 404) {
          return { success: false, error: 'Repository not found or no access' };
        }
        return { success: false, error: (error as { message?: string }).message || `GitHub API error: ${response.status}` };
      }

      const repo = await response.json() as { full_name: string; html_url: string };
      return {
        success: true,
        repoName: repo.full_name,
        repoUrl: repo.html_url,
      };
    } catch (err) {
      return { success: false, error: `Connection failed: ${(err as Error).message}` };
    }
  }

  async fetchGitHubIssue(
    config: GitHubConfig,
    credentials: GitHubCredentials,
    issueNumber: number
  ): Promise<GitHubIssue | null> {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${issueNumber}`,
        {
          headers: {
            Authorization: `Bearer ${credentials.pat}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'Planner-App',
          },
        }
      );

      if (!response.ok) {
        return null;
      }

      return await response.json() as GitHubIssue;
    } catch {
      return null;
    }
  }

  async searchGitHubIssues(
    config: GitHubConfig,
    credentials: GitHubCredentials,
    query: string
  ): Promise<GitHubIssue[]> {
    try {
      // Search in the specific repo - search in title and body
      const searchQuery = `repo:${config.owner}/${config.repo} ${query} in:title,body`;
      const response = await fetch(
        `https://api.github.com/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=20`,
        {
          headers: {
            Authorization: `Bearer ${credentials.pat}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'Planner-App',
          },
        }
      );

      if (!response.ok) {
        // If search fails, fall back to listing recent issues and filtering client-side
        const listResponse = await fetch(
          `https://api.github.com/repos/${config.owner}/${config.repo}/issues?state=all&per_page=50&sort=updated`,
          {
            headers: {
              Authorization: `Bearer ${credentials.pat}`,
              Accept: 'application/vnd.github.v3+json',
              'User-Agent': 'Planner-App',
            },
          }
        );

        if (!listResponse.ok) {
          return [];
        }

        const issues = await listResponse.json() as GitHubIssue[];
        const lowerQuery = query.toLowerCase();
        return issues.filter(
          (issue) =>
            issue.title.toLowerCase().includes(lowerQuery) ||
            (issue.body && issue.body.toLowerCase().includes(lowerQuery))
        );
      }

      const data = await response.json() as { items: GitHubIssue[] };
      return data.items || [];
    } catch {
      return [];
    }
  }

  // ============ Jira Server Integration ============

  private getJiraAuthHeader(credentials: JiraCredentials): string {
    // Jira Server PAT auth: use Bearer token
    // Note: For older Jira Server versions, you might need Basic auth with email:token
    return `Bearer ${credentials.pat}`;
  }

  async testJiraConnection(config: JiraConfig, credentials: JiraCredentials): Promise<JiraConnectionTest> {
    try {
      // Remove trailing slash from baseUrl
      const baseUrl = config.baseUrl.replace(/\/+$/, '');

      // Test by fetching server info
      const response = await fetch(
        `${baseUrl}/rest/api/2/serverInfo`,
        {
          headers: {
            Authorization: this.getJiraAuthHeader(credentials),
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        if (response.status === 401) {
          return { success: false, error: 'Invalid Jira credentials (check your PAT)' };
        }
        if (response.status === 403) {
          return { success: false, error: 'Access forbidden - check PAT permissions' };
        }
        if (response.status === 404) {
          return { success: false, error: 'Jira API not found - check the base URL' };
        }
        const errorText = await response.text().catch(() => '');
        return { success: false, error: `Jira API error: ${response.status} ${errorText}` };
      }

      const serverInfo = await response.json() as { serverTitle?: string; baseUrl?: string };
      return {
        success: true,
        serverTitle: serverInfo.serverTitle || 'Jira Server',
        baseUrl: serverInfo.baseUrl || baseUrl,
      };
    } catch (err) {
      const error = err as Error;
      if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
        return { success: false, error: 'Cannot connect to Jira server - check the URL' };
      }
      return { success: false, error: `Connection failed: ${error.message}` };
    }
  }

  async fetchJiraIssue(
    config: JiraConfig,
    credentials: JiraCredentials,
    issueKey: string
  ): Promise<JiraIssue | null> {
    try {
      const baseUrl = config.baseUrl.replace(/\/+$/, '');
      const response = await fetch(
        `${baseUrl}/rest/api/2/issue/${issueKey}?fields=summary,status,issuetype,priority,assignee`,
        {
          headers: {
            Authorization: this.getJiraAuthHeader(credentials),
            Accept: 'application/json',
          },
        }
      );

      if (!response.ok) {
        return null;
      }

      return await response.json() as JiraIssue;
    } catch {
      return null;
    }
  }

  async searchJiraIssues(
    config: JiraConfig,
    credentials: JiraCredentials,
    query: string,
    projectKey?: string
  ): Promise<JiraIssue[]> {
    try {
      const baseUrl = config.baseUrl.replace(/\/+$/, '');

      // Build JQL query
      let jql = '';
      if (projectKey) {
        jql = `project = "${projectKey}" AND `;
      }
      // Search in summary and description
      jql += `(summary ~ "${query}" OR description ~ "${query}") ORDER BY updated DESC`;

      const response = await fetch(
        `${baseUrl}/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=20&fields=summary,status,issuetype,priority,assignee`,
        {
          headers: {
            Authorization: this.getJiraAuthHeader(credentials),
            Accept: 'application/json',
          },
        }
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as { issues: JiraIssue[] };
      return data.issues || [];
    } catch {
      return [];
    }
  }

  getJiraIssueUrl(baseUrl: string, issueKey: string): string {
    return `${baseUrl.replace(/\/+$/, '')}/browse/${issueKey}`;
  }

  getJiraStatusCategory(issue: JiraIssue): string {
    // Map Jira status category to simple status
    const category = issue.fields.status.statusCategory.key;
    switch (category) {
      case 'done':
        return 'done';
      case 'new':
        return 'open';
      default:
        return 'in progress';
    }
  }

  // ============ Task External Links ============

  async getTaskLinks(taskId: string): Promise<TaskExternalLink[]> {
    const result = await this.fastify.db.query<TaskExternalLink>(
      `SELECT * FROM task_external_links WHERE task_id = $1 ORDER BY created_at`,
      [taskId]
    );
    return result.rows;
  }

  async getTasksLinks(taskIds: string[]): Promise<TaskExternalLink[]> {
    if (taskIds.length === 0) return [];

    const placeholders = taskIds.map((_, i) => `$${i + 1}`).join(', ');
    const result = await this.fastify.db.query<TaskExternalLink>(
      `SELECT * FROM task_external_links WHERE task_id IN (${placeholders}) ORDER BY created_at`,
      taskIds
    );
    return result.rows;
  }

  async addTaskLink(
    taskId: string,
    provider: ExternalLinkProvider,
    externalId: string,
    externalUrl: string,
    title?: string,
    status?: string
  ): Promise<TaskExternalLink> {
    const result = await this.fastify.db.query<TaskExternalLink>(
      `INSERT INTO task_external_links (task_id, provider, external_id, external_url, title, status, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (task_id, provider, external_id) DO UPDATE SET
         external_url = $4,
         title = $5,
         status = $6,
         synced_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [taskId, provider, externalId, externalUrl, title || null, status || null]
    );
    return result.rows[0]!;
  }

  async removeTaskLink(taskId: string, linkId: string): Promise<boolean> {
    const result = await this.fastify.db.query(
      `DELETE FROM task_external_links WHERE id = $1 AND task_id = $2`,
      [linkId, taskId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async syncTaskLink(linkId: string, workspaceId: string): Promise<TaskExternalLink | null> {
    // Get the link
    const linkResult = await this.fastify.db.query<TaskExternalLink>(
      `SELECT tel.* FROM task_external_links tel
       JOIN tasks t ON t.id = tel.task_id
       WHERE tel.id = $1 AND t.workspace_id = $2`,
      [linkId, workspaceId]
    );
    const link = linkResult.rows[0];
    if (!link) return null;

    // Get the integration for this provider
    const integration = await this.getIntegration(workspaceId, link.provider);
    if (!integration || !integration.enabled || !integration.credentials) {
      return link; // Return unchanged if no integration
    }

    if (link.provider === 'github') {
      const config = integration.config as GitHubConfig;
      const credentials = integration.credentials as GitHubCredentials;
      const issueNumber = parseInt(link.external_id, 10);

      const issue = await this.fetchGitHubIssue(config, credentials, issueNumber);
      if (issue) {
        return this.addTaskLink(
          link.task_id,
          'github',
          link.external_id,
          issue.html_url,
          issue.title,
          issue.state
        );
      }
    } else if (link.provider === 'jira') {
      const config = integration.config as JiraConfig;
      const credentials = integration.credentials as JiraCredentials;

      const issue = await this.fetchJiraIssue(config, credentials, link.external_id);
      if (issue) {
        return this.addTaskLink(
          link.task_id,
          'jira',
          issue.key,
          this.getJiraIssueUrl(config.baseUrl, issue.key),
          issue.fields.summary,
          this.getJiraStatusCategory(issue)
        );
      }
    }

    return link;
  }

  async syncAllTaskLinks(taskId: string, workspaceId: string): Promise<TaskExternalLink[]> {
    const links = await this.getTaskLinks(taskId);
    const synced: TaskExternalLink[] = [];

    for (const link of links) {
      const updated = await this.syncTaskLink(link.id, workspaceId);
      if (updated) synced.push(updated);
    }

    return synced;
  }
}
