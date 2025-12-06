import { Pool } from 'pg';
import { hashPassword } from '../../utils/password.js';
import { randomBytes } from 'crypto';
import type { User, Organization, Workspace, Task } from '../../types/index.js';

/**
 * Create a test user
 */
export async function createTestUser(
  db: Pool,
  overrides: {
    email?: string;
    password?: string;
    name?: string;
    capacity_week_hours?: number;
  } = {}
): Promise<User> {
  const email = overrides.email || `test-${randomBytes(4).toString('hex')}@example.com`;
  const password = overrides.password || 'Password123!';
  const name = overrides.name || 'Test User';
  const capacity_week_hours = overrides.capacity_week_hours || 40;

  const passwordHash = await hashPassword(password);

  const result = await db.query<User>(
    `INSERT INTO users (email, password_hash, name, capacity_week_hours)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [email, passwordHash, name, capacity_week_hours]
  );

  return result.rows[0]!;
}

/**
 * Create a test organization
 */
export async function createTestOrganization(
  db: Pool,
  ownerId: string,
  overrides: {
    name?: string;
    slug?: string;
    plan?: string;
    billing_email?: string;
  } = {}
): Promise<Organization> {
  const name = overrides.name || `Test Org ${randomBytes(4).toString('hex')}`;
  const slug = overrides.slug || `test-org-${randomBytes(4).toString('hex')}`;
  const plan = overrides.plan || 'free';
  const billing_email = overrides.billing_email || 'billing@example.com';

  const result = await db.query<Organization>(
    `INSERT INTO organizations (name, slug, owner_id, billing_email, plan, plan_limits)
     VALUES ($1, $2, $3, $4, $5, '{"max_users": 3, "max_workspaces": 1, "max_integrations": 0}')
     RETURNING *`,
    [name, slug, ownerId, billing_email, plan]
  );

  const org = result.rows[0]!;

  // Add owner role
  await db.query(
    `INSERT INTO user_organization_roles (organization_id, user_id, role)
     VALUES ($1, $2, 'OWNER')`,
    [org.id, ownerId]
  );

  return org;
}

/**
 * Create a test workspace
 */
export async function createTestWorkspace(
  db: Pool,
  ownerId: string,
  organizationId: string,
  overrides: {
    name?: string;
  } = {}
): Promise<Workspace> {
  const name = overrides.name || `Test Workspace ${randomBytes(4).toString('hex')}`;

  const result = await db.query<Workspace>(
    `INSERT INTO workspaces (name, owner_id, organization_id)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [name, ownerId, organizationId]
  );

  const workspace = result.rows[0]!;

  // Add owner as admin
  await db.query(
    `INSERT INTO user_workspace_roles (workspace_id, user_id, role)
     VALUES ($1, $2, 'ADMIN')`,
    [workspace.id, ownerId]
  );

  return workspace;
}

/**
 * Create a test task
 */
export async function createTestTask(
  db: Pool,
  workspaceId: string,
  overrides: {
    title?: string;
    description?: string;
    estimated_hours?: number;
    assigned_to_user_id?: string | null;
    start_date?: string | null;
    due_date?: string | null;
    status?: string;
    priority?: string;
  } = {}
): Promise<Task> {
  const title = overrides.title || `Test Task ${randomBytes(4).toString('hex')}`;
  const description = overrides.description || 'Test task description';
  const estimated_hours = overrides.estimated_hours !== undefined ? overrides.estimated_hours : 8;
  const status = overrides.status || 'BACKLOG';
  const priority = overrides.priority || 'MED';

  const result = await db.query<Task>(
    `INSERT INTO tasks (
      workspace_id, title, description, estimated_hours,
      assigned_to_user_id, start_date, due_date, status, priority
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      workspaceId,
      title,
      description,
      estimated_hours,
      overrides.assigned_to_user_id ?? null,
      overrides.start_date ?? null,
      overrides.due_date ?? null,
      status,
      priority,
    ]
  );

  return result.rows[0]!;
}

/**
 * Add a user to a workspace with a specific role
 */
export async function addUserToWorkspace(
  db: Pool,
  workspaceId: string,
  userId: string,
  role: 'ADMIN' | 'TEAM_LEAD' | 'DEVELOPER' | 'READ_ONLY' = 'DEVELOPER'
): Promise<void> {
  await db.query(
    `INSERT INTO user_workspace_roles (workspace_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = $3`,
    [workspaceId, userId, role]
  );
}

/**
 * Create a refresh token for a user
 */
export async function createRefreshToken(
  db: Pool,
  userId: string,
  daysValid: number = 30
): Promise<string> {
  const token = randomBytes(64).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + daysValid);

  await db.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, token, expiresAt]
  );

  return token;
}

/**
 * Create a complete test setup with user, org, and workspace
 */
export async function createTestSetup(db: Pool): Promise<{
  user: User;
  organization: Organization;
  workspace: Workspace;
}> {
  const user = await createTestUser(db);
  const organization = await createTestOrganization(db, user.id);
  const workspace = await createTestWorkspace(db, user.id, organization.id);

  return { user, organization, workspace };
}
