import type { Pool } from 'pg';

declare module 'fastify' {
  interface FastifyInstance {
    db: Pool;
    config: Env;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

// Environment configuration
export interface Env {
  DATABASE_URL: string;
  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  PORT: number;
  HOST: string;
  NODE_ENV: 'development' | 'production' | 'test';
  APP_URL: string;
  // Stripe (optional)
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_STARTER?: string;
  STRIPE_PRICE_PRO?: string;
  // Email (optional)
  RESEND_API_KEY?: string;
  EMAIL_FROM: string;
  // AI (optional)
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  AI_DEFAULT_PROVIDER: 'openai' | 'anthropic';
  AI_DEFAULT_MODEL: string;
  AI_MAX_TOKENS_PER_REQUEST: number;
  AI_TEMPERATURE: number;
  AI_MONTHLY_TOKEN_LIMIT_DEFAULT: number;
}

// JWT Payload
export interface JwtPayload {
  id: string;
  email: string;
  impersonated_by?: string; // Admin ID when impersonating a user
}

// User types
export interface User {
  id: string;
  email: string;
  name: string | null;
  password_hash: string;
  capacity_week_hours: number;
  timezone: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export type UserPublic = Omit<User, 'password_hash'>;

// Workspace types
export interface Workspace {
  id: string;
  name: string;
  owner_id: string | null;
  organization_id: string | null;
  created_at: Date;
}

// Role types
export type WorkspaceRole = 'ADMIN' | 'TEAM_LEAD' | 'DEVELOPER' | 'READ_ONLY';

export interface UserWorkspaceRole {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
}

// Task types
export type TaskStatus = 'BACKLOG' | 'PLANNED' | 'IN_PROGRESS' | 'BLOCKED' | 'ON_HOLD' | 'DONE';
export type TaskPriority = 'LOW' | 'MED' | 'HIGH' | 'CRITICAL';
export type TaskSource = 'manual' | 'jira' | 'github';

export interface Task {
  id: string;
  key: string;
  workspace_id: string;
  title: string;
  description: string | null;
  estimated_hours: number;
  assigned_to_user_id: string | null;
  start_date: string | null;
  due_date: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  source: TaskSource;
  jira_key: string | null;
  github_issue_number: number | null;
  project: string | null;
  epic_id: string | null;
  epic_name: string | null;
  project_id: string | null;
  project_name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

// Task dependency types
export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export interface TaskDependency {
  id: string;
  task_id: string;
  depends_on_task_id: string;
  type: DependencyType;
}

// Integration types
export type IntegrationType = 'jira' | 'github';

export interface Integration {
  id: string;
  workspace_id: string;
  type: IntegrationType;
  config: Record<string, unknown> | null;
  credentials: Record<string, unknown> | null;
  enabled: boolean;
  created_at: Date;
}

// GitHub-specific config
export interface GitHubConfig {
  owner: string; // GitHub org or username
  repo: string;  // Repository name
  [key: string]: unknown;
}

// GitHub credentials
export interface GitHubCredentials {
  pat: string; // Personal Access Token
  [key: string]: unknown;
}

// Jira-specific config
export interface JiraConfig {
  baseUrl: string; // e.g., https://jira.company.com
  projectKey?: string; // Optional default project
  [key: string]: unknown;
}

// Jira credentials (PAT for now, OAuth later)
export interface JiraCredentials {
  pat: string;
  email: string; // Required for Jira Server PAT auth
  [key: string]: unknown;
}

// Task external link types
export type ExternalLinkProvider = 'github' | 'jira';

export interface TaskExternalLink {
  id: string;
  task_id: string;
  provider: ExternalLinkProvider;
  external_id: string;
  external_url: string;
  title: string | null;
  status: string | null;
  synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// GitHub issue from API
export interface GitHubIssue {
  number: number;
  title: string;
  body?: string | null;
  state: 'open' | 'closed';
  html_url: string;
  labels: Array<{ name: string; color: string }>;
  assignee: { login: string } | null;
  created_at: string;
  updated_at: string;
}

// Jira issue from API
export interface JiraIssue {
  key: string; // e.g., "PROJ-123"
  fields: {
    summary: string;
    status: {
      name: string;
      statusCategory: {
        key: string; // "new", "indeterminate", "done"
        name: string;
      };
    };
    issuetype: {
      name: string;
      iconUrl: string;
    };
    priority?: {
      name: string;
      iconUrl: string;
    };
    assignee?: {
      displayName: string;
      emailAddress: string;
    } | null;
  };
  self: string; // API URL
}

// Time entry types (for tracking actual hours spent)
export interface TimeEntry {
  id: string;
  task_id: string;
  user_id: string;
  date: string;
  hours: number;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

// Time off types
export type TimeOffType = 'VACATION' | 'HOLIDAY' | 'SICK' | 'OTHER';

export interface TimeOff {
  id: string;
  user_id: string;
  date_from: string;
  date_to: string;
  type: TimeOffType;
  created_at: Date;
}

// Audit log types
export interface AuditLog {
  id: string;
  entity_type: string;
  entity_id: string | null;
  user_id: string | null;
  action: string;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

// Refresh token types
export interface RefreshToken {
  id: string;
  user_id: string;
  token: string;
  expires_at: Date;
  created_at: Date;
}

// API Response types
export interface ApiError {
  error: string;
  code: string;
}

// Planning types
export interface UserCapacity {
  id: string;
  email: string;
  name: string | null;
  capacity_hours: number;
  planned_hours: number;
  remaining_hours: number;
  overloaded: boolean;
}

export interface WeekPlanningResponse {
  users: UserCapacity[];
  tasks: Task[];
}

// Organization types (Multi-tenant)
export type OrganizationRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export type SubscriptionStatus = 'none' | 'trialing' | 'active' | 'past_due' | 'canceled';
export type PlanType = 'free' | 'starter' | 'pro' | 'enterprise';

export interface PlanLimits {
  max_users: number;
  max_workspaces: number;
  max_integrations: number;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  owner_id: string | null;
  owner_email?: string; // Optional: populated in getUserOrganizations
  owner_name?: string | null; // Optional: populated in getUserOrganizations
  plan: PlanType;
  plan_limits: PlanLimits;
  billing_email: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: SubscriptionStatus;
  current_period_end: Date | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UserOrganizationRole {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrganizationRole;
  created_at: Date;
}

export interface Invitation {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  email: string;
  role: OrganizationRole;
  workspace_role: WorkspaceRole | null;
  token: string;
  invited_by: string | null;
  expires_at: Date;
  accepted_at: Date | null;
  created_at: Date;
}

// Organization member with user details
export interface OrganizationMember {
  user_id: string;
  email: string;
  name: string | null;
  role: OrganizationRole;
  created_at: Date;
}

// Organization usage stats
export interface OrganizationUsage {
  users: number;
  workspaces: number;
  integrations: number;
  tasks: number;
}

// AI Project Manager types
export type AIProvider = 'openai' | 'anthropic';
export type AIMessageRole = 'user' | 'assistant' | 'system';

export interface AIConversation {
  id: string;
  workspace_id: string;
  created_by_user_id: string;
  title: string | null;
  is_archived: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface AIMessage {
  id: string;
  conversation_id: string;
  role: AIMessageRole;
  content: string;
  structured_data: AIStructuredData | null;
  input_tokens: number | null;
  output_tokens: number | null;
  model: string | null;
  created_at: Date;
}

export interface AIUsage {
  id: string;
  workspace_id: string;
  month: Date;
  input_tokens_used: number;
  output_tokens_used: number;
  request_count: number;
}

export interface AISettings {
  workspace_id: string;
  enabled: boolean;
  preferred_provider: AIProvider;
  preferred_model: string;
  monthly_token_limit: number | null;
  created_at: Date;
  updated_at: Date;
}

// AI Function Call Info for developer visibility
export interface FunctionCallInfo {
  name: string;
  arguments: Record<string, unknown>;
  result: {
    success: boolean;
    summary: string;
  };
  executedAt: string;
}

// AI Structured Data types for rich responses
export type AIStructuredData =
  | TaskSuggestionsData
  | ScheduleSuggestionData
  | CapacityOverviewData
  | ProjectWizardSuggestionData
  | ProjectWizardProgressData
  | ProjectWizardReviewData
  | ProjectCreatedData;

export interface TaskSuggestionsData {
  type: 'task_suggestions';
  tasks: {
    tempId: string;
    title: string;
    description?: string;
    estimatedHours: number;
    priority: 'LOW' | 'MED' | 'HIGH' | 'CRITICAL';
    suggestedAssignee?: string;
    category?: string;
  }[];
}

export interface ScheduleSuggestionData {
  type: 'schedule_suggestion';
  changes: {
    taskId: string;
    action: 'move' | 'reassign' | 'resize';
    from: { startDate?: string; assigneeId?: string; hours?: number };
    to: { startDate?: string; assigneeId?: string; hours?: number };
    reason: string;
  }[];
}

export interface CapacityOverviewData {
  type: 'capacity_overview';
  period: { start: string; end: string };
  team: {
    userId: string;
    name: string;
    capacity: number;
    allocated: number;
    available: number;
    status: 'available' | 'busy' | 'overloaded';
  }[];
}

// Project Wizard Structured Data types
// Initial suggestion when AI detects a large project
export interface ProjectWizardSuggestionData {
  type: 'project_wizard_suggestion';
  projectName: string;
  detectedScope: string;
  suggestedEpics: string[];
}

// Live-updating progress card during wizard conversation
export interface ProjectWizardProgressData {
  type: 'project_wizard_progress';
  step: 'name' | 'epics' | 'dependencies' | 'review';
  project: {
    name: string;
    description: string;
    goals: string;
    confirmed: boolean;
  };
  epics: Array<{
    id: string; // Temporary ID for reference during conversation
    name: string;
    description: string;
    estimatedWeeks: number;
    priority: 'LOW' | 'MED' | 'HIGH' | 'CRITICAL';
    confirmed: boolean;
  }>;
  dependencies: Array<{
    fromEpicId: string;
    toEpicId: string;
    confirmed: boolean;
  }>;
}

// Final review before project creation
export interface ProjectWizardReviewData {
  type: 'project_wizard_review';
  project: {
    name: string;
    description: string;
    goals: string;
  };
  epics: Array<{
    id: string;
    name: string;
    description: string;
    estimatedWeeks: number;
    priority: 'LOW' | 'MED' | 'HIGH' | 'CRITICAL';
  }>;
  dependencies: Array<{
    fromEpicId: string;
    fromEpicName: string;
    toEpicId: string;
    toEpicName: string;
  }>;
  readyToCreate: boolean;
}

// Success response after project is created
export interface ProjectCreatedData {
  type: 'project_created';
  projectId: string;
  projectName: string;
  epicCount: number;
  epics: Array<{
    id: string;
    name: string;
  }>;
}

// ============================================
// PROJECT & EPIC TYPES
// ============================================

export type ProjectStatus = 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled';

export type EpicStatus =
  | 'draft'
  | 'ready_for_breakdown'
  | 'breaking_down'
  | 'ready'
  | 'in_progress'
  | 'done';

export type EpicDependencyType = 'blocks' | 'related' | 'informs';

export interface Project {
  id: string;
  key: string;
  workspace_id: string;
  name: string;
  description: string | null;
  goals: string | null;
  status: ProjectStatus;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface Epic {
  id: string;
  key: string;
  project_id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  status: EpicStatus;
  priority: TaskPriority;
  estimated_weeks: number | null;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

export interface EpicDependency {
  epic_id: string;
  depends_on_epic_id: string;
  dependency_type: EpicDependencyType;
  created_at: Date;
}

export interface ProjectWithEpics extends Project {
  epics: EpicWithDependencies[];
}

export interface EpicWithDependencies extends Epic {
  dependencies: EpicDependency[];
  dependents: EpicDependency[];
  story_count: number;
}
