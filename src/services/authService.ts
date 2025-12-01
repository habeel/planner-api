import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'crypto';
import { hashPassword, verifyPassword } from '../utils/password.js';
import type { User, UserPublic, Organization } from '../types/index.js';
import { OrganizationService } from './organizationService.js';
import { WorkspaceService } from './workspaceService.js';

export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
  organization_name?: string;
  organization_slug?: string;
}

export interface RegisterResult {
  user: UserPublic;
  accessToken: string;
  refreshToken: string;
  organization?: Organization;
}

export class AuthService {
  constructor(private fastify: FastifyInstance) {}

  /**
   * Register a new user and optionally create an organization for them.
   * If organization_name is provided, creates an org and a default workspace.
   */
  async register(input: RegisterInput): Promise<RegisterResult> {
    const { email, password, name, organization_name, organization_slug } = input;
    const passwordHash = await hashPassword(password);

    const client = await this.fastify.db.connect();

    try {
      await client.query('BEGIN');

      // Create user
      const userResult = await client.query<User>(
        `INSERT INTO users (email, password_hash, name)
         VALUES ($1, $2, $3)
         RETURNING id, email, name, capacity_week_hours, timezone, is_active, created_at, updated_at`,
        [email, passwordHash, name || null]
      );

      const user = userResult.rows[0]!;
      let organization: Organization;

      // Create organization - use provided name or default to "Personal"
      const orgService = new OrganizationService(this.fastify);
      const orgName = organization_name || 'Personal';
      const slug = organization_slug || orgService.generateSlug(orgName);

      // Create organization
      const orgResult = await client.query<Organization>(
        `INSERT INTO organizations (name, slug, owner_id, billing_email, plan, plan_limits)
         VALUES ($1, $2, $3, $4, 'free', '{"max_users": 3, "max_workspaces": 1, "max_integrations": 0}')
         RETURNING *`,
        [orgName, slug, user.id, email]
      );

      organization = orgResult.rows[0]!;

      // Add user as OWNER
      await client.query(
        `INSERT INTO user_organization_roles (organization_id, user_id, role)
         VALUES ($1, $2, 'OWNER')`,
        [organization.id, user.id]
      );

      // Create default workspace
      const workspaceResult = await client.query(
        `INSERT INTO workspaces (name, owner_id, organization_id)
         VALUES ($1, $2, $3)
         RETURNING *`,
        ['Default Workspace', user.id, organization.id]
      );

      const workspace = workspaceResult.rows[0]!;

      // Add user as workspace admin
      await client.query(
        `INSERT INTO user_workspace_roles (workspace_id, user_id, role)
         VALUES ($1, $2, 'ADMIN')`,
        [workspace.id, user.id]
      );

      // Generate tokens
      const tokens = await this.generateTokensWithClient(client, user);

      await client.query('COMMIT');

      return {
        user: this.toPublicUser(user),
        ...tokens,
        organization,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * @deprecated Use register(input) instead. Kept for backward compatibility.
   */
  async registerLegacy(
    email: string,
    password: string,
    name?: string
  ): Promise<{ user: UserPublic; accessToken: string; refreshToken: string }> {
    const passwordHash = await hashPassword(password);

    const result = await this.fastify.db.query<User>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, capacity_week_hours, timezone, is_active, created_at, updated_at`,
      [email, passwordHash, name || null]
    );

    const user = result.rows[0]!;
    const tokens = await this.generateTokens(user);

    return {
      user: this.toPublicUser(user),
      ...tokens,
    };
  }

  async login(
    email: string,
    password: string
  ): Promise<{ user: UserPublic; accessToken: string; refreshToken: string } | null> {
    const result = await this.fastify.db.query<User>(
      `SELECT * FROM users WHERE email = $1 AND is_active = true`,
      [email]
    );

    const user = result.rows[0];
    if (!user) return null;

    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) return null;

    const tokens = await this.generateTokens(user);

    return {
      user: this.toPublicUser(user),
      ...tokens,
    };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string } | null> {
    const result = await this.fastify.db.query(
      `SELECT rt.*, u.email FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token = $1 AND rt.expires_at > NOW()`,
      [refreshToken]
    );

    const tokenRow = result.rows[0];
    if (!tokenRow) return null;

    const accessToken = this.fastify.jwt.sign({
      id: tokenRow.user_id,
      email: tokenRow.email,
    });

    return { accessToken };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.fastify.db.query(
      `DELETE FROM refresh_tokens WHERE token = $1`,
      [refreshToken]
    );
  }

  private async generateTokens(user: User): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = this.fastify.jwt.sign({
      id: user.id,
      email: user.email,
    });

    const refreshToken = randomBytes(64).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

    await this.fastify.db.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, refreshToken, expiresAt]
    );

    return { accessToken, refreshToken };
  }

  private async generateTokensWithClient(
    client: { query: (query: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
    user: User
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = this.fastify.jwt.sign({
      id: user.id,
      email: user.email,
    });

    const refreshToken = randomBytes(64).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

    await client.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, refreshToken, expiresAt]
    );

    return { accessToken, refreshToken };
  }

  private toPublicUser(user: User): UserPublic {
    const { password_hash, ...publicUser } = user;
    return publicUser;
  }
}
