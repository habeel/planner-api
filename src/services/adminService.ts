import type { FastifyInstance } from 'fastify';
import { randomBytes, createHash } from 'crypto';
import { hashPassword, verifyPassword } from '../utils/password.js';

// Types
export type AdminRole = 'OWNER' | 'ADMIN' | 'SUPPORT';
export type PlanType = 'free' | 'starter' | 'pro' | 'enterprise';

export interface PlatformAdmin {
  id: string;
  email: string;
  name: string | null;
  role: AdminRole;
  is_active: boolean;
  failed_login_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminSession {
  id: string;
  admin_id: string;
  token: string;
  expires_at: string;
  ip_address: string | null;
  user_agent: string | null;
}

export interface AdminAuditLog {
  id: string;
  admin_id: string | null;
  admin_email: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

export interface DashboardStats {
  organizations: {
    total: number;
    active: number;
    inactive: number;
    byPlan: Record<PlanType, number>;
  };
  users: {
    total: number;
    active: number;
    inactive: number;
  };
  subscriptions: {
    total: number;
    mrr: number; // Monthly recurring revenue in cents
    byPlan: Record<string, number>;
  };
  recentSignups: Array<{
    id: string;
    email: string;
    name: string | null;
    created_at: string;
  }>;
}

export interface GrowthMetrics {
  period: string;
  data: Array<{
    date: string;
    newUsers: number;
    newOrgs: number;
  }>;
}

export interface RevenueMetrics {
  period: string;
  data: Array<{
    date: string;
    mrr: number;
    newSubscriptions: number;
    cancellations: number;
  }>;
}

export interface Pagination {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface OrgFilters {
  search?: string;
  plan?: PlanType;
  status?: 'active' | 'inactive';
  sortBy?: 'created_at' | 'name' | 'users';
  sortOrder?: 'asc' | 'desc';
}

export interface UserFilters {
  search?: string;
  status?: 'active' | 'inactive';
  sortBy?: 'created_at' | 'email' | 'name';
  sortOrder?: 'asc' | 'desc';
}

export interface AuditFilters {
  adminId?: string;
  action?: string;
  targetType?: string;
  from?: string;
  to?: string;
}

export interface OrganizationDetails {
  id: string;
  name: string;
  slug: string;
  owner_id: string | null;
  owner_email: string | null;
  owner_name: string | null;
  plan: PlanType;
  plan_limits: Record<string, number>;
  billing_email: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string;
  current_period_end: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  member_count: number;
  workspace_count: number;
  task_count: number;
}

export interface UserDetails {
  id: string;
  email: string;
  name: string | null;
  capacity_week_hours: number;
  timezone: string;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  organizations: Array<{
    id: string;
    name: string;
    role: string;
  }>;
}

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;
const SESSION_DURATION_HOURS = 8;

export class AdminService {
  constructor(private fastify: FastifyInstance) {}

  // ==================== Authentication ====================

  async login(
    email: string,
    password: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ admin: Omit<PlatformAdmin, 'failed_login_attempts' | 'locked_until'>; token: string } | null> {
    const result = await this.fastify.db.query<PlatformAdmin>(
      `SELECT * FROM platform_admins WHERE email = $1`,
      [email]
    );

    const admin = result.rows[0];
    if (!admin) return null;

    // Check if account is locked
    if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
      throw new Error('ACCOUNT_LOCKED');
    }

    // Check if account is active
    if (!admin.is_active) {
      throw new Error('ACCOUNT_DISABLED');
    }

    const isValid = await verifyPassword(password, (admin as unknown as { password_hash: string }).password_hash);

    if (!isValid) {
      // Increment failed attempts
      const newAttempts = admin.failed_login_attempts + 1;
      let lockUntil = null;

      if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
        lockUntil = new Date();
        lockUntil.setMinutes(lockUntil.getMinutes() + LOCKOUT_DURATION_MINUTES);
      }

      await this.fastify.db.query(
        `UPDATE platform_admins SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3`,
        [newAttempts, lockUntil, admin.id]
      );

      return null;
    }

    // Reset failed attempts and update last login
    await this.fastify.db.query(
      `UPDATE platform_admins SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1`,
      [admin.id]
    );

    // Create session
    const token = randomBytes(64).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + SESSION_DURATION_HOURS);

    await this.fastify.db.query(
      `INSERT INTO admin_sessions (admin_id, token_hash, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [admin.id, tokenHash, expiresAt, ipAddress || null, userAgent || null]
    );

    // Log the action
    await this.logAction(admin.id, admin.email, 'LOGIN', undefined, undefined, { ip: ipAddress }, ipAddress);

    return {
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        is_active: admin.is_active,
        last_login_at: new Date().toISOString(),
        created_at: admin.created_at,
        updated_at: admin.updated_at,
      },
      token,
    };
  }

  async validateSession(token: string): Promise<PlatformAdmin | null> {
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const result = await this.fastify.db.query<PlatformAdmin & { session_id: string }>(
      `SELECT pa.*, s.id as session_id
       FROM admin_sessions s
       JOIN platform_admins pa ON pa.id = s.admin_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW() AND pa.is_active = true`,
      [tokenHash]
    );

    return result.rows[0] || null;
  }

  async logout(token: string): Promise<void> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await this.fastify.db.query(
      `DELETE FROM admin_sessions WHERE token_hash = $1`,
      [tokenHash]
    );
  }

  async logoutAllSessions(adminId: string): Promise<void> {
    await this.fastify.db.query(
      `DELETE FROM admin_sessions WHERE admin_id = $1`,
      [adminId]
    );
  }

  // ==================== Dashboard Stats ====================

  async getDashboardStats(): Promise<DashboardStats> {
    // Organization stats
    const orgStats = await this.fastify.db.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_active = true) as active,
        COUNT(*) FILTER (WHERE is_active = false) as inactive,
        COUNT(*) FILTER (WHERE plan = 'free') as plan_free,
        COUNT(*) FILTER (WHERE plan = 'starter') as plan_starter,
        COUNT(*) FILTER (WHERE plan = 'pro') as plan_pro,
        COUNT(*) FILTER (WHERE plan = 'enterprise') as plan_enterprise
      FROM organizations
    `);

    // User stats
    const userStats = await this.fastify.db.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_active = true) as active,
        COUNT(*) FILTER (WHERE is_active = false) as inactive
      FROM users
    `);

    // Subscription stats (from organizations with active subscriptions)
    const subStats = await this.fastify.db.query(`
      SELECT
        COUNT(*) FILTER (WHERE subscription_status = 'active') as total,
        COUNT(*) FILTER (WHERE subscription_status = 'active' AND plan = 'starter') as starter,
        COUNT(*) FILTER (WHERE subscription_status = 'active' AND plan = 'pro') as pro
      FROM organizations
    `);

    // Calculate MRR (simplified - actual would need seat counts from Stripe)
    const starterCount = parseInt(subStats.rows[0]?.starter || '0');
    const proCount = parseInt(subStats.rows[0]?.pro || '0');
    const mrr = (starterCount * 400) + (proCount * 700); // $4 and $7 in cents

    // Recent signups
    const recentSignups = await this.fastify.db.query(`
      SELECT id, email, name, created_at
      FROM users
      ORDER BY created_at DESC
      LIMIT 10
    `);

    const org = orgStats.rows[0] || {};
    const user = userStats.rows[0] || {};
    const sub = subStats.rows[0] || {};

    return {
      organizations: {
        total: parseInt(org.total || '0'),
        active: parseInt(org.active || '0'),
        inactive: parseInt(org.inactive || '0'),
        byPlan: {
          free: parseInt(org.plan_free || '0'),
          starter: parseInt(org.plan_starter || '0'),
          pro: parseInt(org.plan_pro || '0'),
          enterprise: parseInt(org.plan_enterprise || '0'),
        },
      },
      users: {
        total: parseInt(user.total || '0'),
        active: parseInt(user.active || '0'),
        inactive: parseInt(user.inactive || '0'),
      },
      subscriptions: {
        total: parseInt(sub.total || '0'),
        mrr,
        byPlan: {
          starter: starterCount,
          pro: proCount,
        },
      },
      recentSignups: recentSignups.rows,
    };
  }

  async getGrowthMetrics(period: 'week' | 'month' | 'year'): Promise<GrowthMetrics> {
    const intervals = {
      week: { interval: '7 days', trunc: 'day' },
      month: { interval: '30 days', trunc: 'day' },
      year: { interval: '365 days', trunc: 'month' },
    };

    const { interval, trunc } = intervals[period];

    const result = await this.fastify.db.query(`
      WITH date_series AS (
        SELECT generate_series(
          date_trunc('${trunc}', NOW() - INTERVAL '${interval}'),
          date_trunc('${trunc}', NOW()),
          INTERVAL '1 ${trunc}'
        ) as date
      ),
      user_counts AS (
        SELECT date_trunc('${trunc}', created_at) as date, COUNT(*) as count
        FROM users
        WHERE created_at >= NOW() - INTERVAL '${interval}'
        GROUP BY 1
      ),
      org_counts AS (
        SELECT date_trunc('${trunc}', created_at) as date, COUNT(*) as count
        FROM organizations
        WHERE created_at >= NOW() - INTERVAL '${interval}'
        GROUP BY 1
      )
      SELECT
        ds.date,
        COALESCE(uc.count, 0) as new_users,
        COALESCE(oc.count, 0) as new_orgs
      FROM date_series ds
      LEFT JOIN user_counts uc ON ds.date = uc.date
      LEFT JOIN org_counts oc ON ds.date = oc.date
      ORDER BY ds.date
    `);

    return {
      period,
      data: result.rows.map((row) => ({
        date: row.date,
        newUsers: parseInt(row.new_users),
        newOrgs: parseInt(row.new_orgs),
      })),
    };
  }

  async getRevenueMetrics(period: 'week' | 'month' | 'year'): Promise<RevenueMetrics> {
    // Simplified revenue metrics - in production, integrate with Stripe reporting API
    const intervals = {
      week: { interval: '7 days', trunc: 'day' },
      month: { interval: '30 days', trunc: 'day' },
      year: { interval: '365 days', trunc: 'month' },
    };

    const { interval, trunc } = intervals[period];

    // This is a simplified version - real implementation would query Stripe
    const result = await this.fastify.db.query(`
      WITH date_series AS (
        SELECT generate_series(
          date_trunc('${trunc}', NOW() - INTERVAL '${interval}'),
          date_trunc('${trunc}', NOW()),
          INTERVAL '1 ${trunc}'
        ) as date
      )
      SELECT
        ds.date,
        0 as mrr,
        0 as new_subscriptions,
        0 as cancellations
      FROM date_series ds
      ORDER BY ds.date
    `);

    return {
      period,
      data: result.rows.map((row) => ({
        date: row.date,
        mrr: parseInt(row.mrr),
        newSubscriptions: parseInt(row.new_subscriptions),
        cancellations: parseInt(row.cancellations),
      })),
    };
  }

  // ==================== Organization Management ====================

  async listOrganizations(
    filters: OrgFilters,
    pagination: Pagination
  ): Promise<PaginatedResult<OrganizationDetails>> {
    const { page, limit } = pagination;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.search) {
      whereClause += ` AND (o.name ILIKE $${paramIndex} OR o.slug ILIKE $${paramIndex})`;
      params.push(`%${filters.search}%`);
      paramIndex++;
    }

    if (filters.plan) {
      whereClause += ` AND o.plan = $${paramIndex}`;
      params.push(filters.plan);
      paramIndex++;
    }

    if (filters.status === 'active') {
      whereClause += ` AND o.is_active = true`;
    } else if (filters.status === 'inactive') {
      whereClause += ` AND o.is_active = false`;
    }

    const sortBy = filters.sortBy || 'created_at';
    const sortOrder = filters.sortOrder || 'desc';
    const orderClause = `ORDER BY o.${sortBy} ${sortOrder}`;

    // Count total
    const countResult = await this.fastify.db.query(
      `SELECT COUNT(*) FROM organizations o ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count || '0');

    // Get items with member count
    const result = await this.fastify.db.query<OrganizationDetails>(
      `SELECT
        o.*,
        u.email as owner_email,
        u.name as owner_name,
        (SELECT COUNT(*) FROM user_organization_roles WHERE organization_id = o.id) as member_count,
        (SELECT COUNT(*) FROM workspaces WHERE organization_id = o.id) as workspace_count,
        (SELECT COUNT(*) FROM tasks t JOIN workspaces w ON t.workspace_id = w.id WHERE w.organization_id = o.id) as task_count
      FROM organizations o
      LEFT JOIN users u ON o.owner_id = u.id
      ${whereClause}
      ${orderClause}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return {
      items: result.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getOrganizationDetails(orgId: string): Promise<OrganizationDetails | null> {
    const result = await this.fastify.db.query<OrganizationDetails>(
      `SELECT
        o.*,
        u.email as owner_email,
        u.name as owner_name,
        (SELECT COUNT(*) FROM user_organization_roles WHERE organization_id = o.id) as member_count,
        (SELECT COUNT(*) FROM workspaces WHERE organization_id = o.id) as workspace_count,
        (SELECT COUNT(*) FROM tasks t JOIN workspaces w ON t.workspace_id = w.id WHERE w.organization_id = o.id) as task_count
      FROM organizations o
      LEFT JOIN users u ON o.owner_id = u.id
      WHERE o.id = $1`,
      [orgId]
    );

    return result.rows[0] || null;
  }

  async updateOrganizationPlan(
    orgId: string,
    plan: PlanType,
    adminId: string,
    adminEmail: string,
    ipAddress?: string
  ): Promise<void> {
    const planLimits: Record<PlanType, Record<string, number>> = {
      free: { max_users: 3, max_workspaces: 1, max_integrations: 0 },
      starter: { max_users: -1, max_workspaces: 3, max_integrations: 3 },
      pro: { max_users: -1, max_workspaces: -1, max_integrations: -1 },
      enterprise: { max_users: -1, max_workspaces: -1, max_integrations: -1 },
    };

    await this.fastify.db.query(
      `UPDATE organizations SET plan = $1, plan_limits = $2, updated_at = NOW() WHERE id = $3`,
      [plan, JSON.stringify(planLimits[plan]), orgId]
    );

    await this.logAction(adminId, adminEmail, 'UPDATE_ORG_PLAN', 'organization', orgId, { plan }, ipAddress);
  }

  async toggleOrganizationActive(
    orgId: string,
    active: boolean,
    adminId: string,
    adminEmail: string,
    ipAddress?: string
  ): Promise<void> {
    await this.fastify.db.query(
      `UPDATE organizations SET is_active = $1, updated_at = NOW() WHERE id = $2`,
      [active, orgId]
    );

    await this.logAction(
      adminId,
      adminEmail,
      active ? 'ENABLE_ORG' : 'DISABLE_ORG',
      'organization',
      orgId,
      undefined,
      ipAddress
    );
  }

  async deleteOrganization(
    orgId: string,
    hardDelete: boolean,
    adminId: string,
    adminEmail: string,
    ipAddress?: string
  ): Promise<void> {
    if (hardDelete) {
      // Hard delete - cascade will handle related records
      await this.fastify.db.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    } else {
      // Soft delete
      await this.fastify.db.query(
        `UPDATE organizations SET is_active = false, updated_at = NOW() WHERE id = $1`,
        [orgId]
      );
    }

    await this.logAction(
      adminId,
      adminEmail,
      hardDelete ? 'HARD_DELETE_ORG' : 'SOFT_DELETE_ORG',
      'organization',
      orgId,
      undefined,
      ipAddress
    );
  }

  async impersonateOrgOwner(
    orgId: string,
    adminId: string,
    adminEmail: string,
    ipAddress?: string
  ): Promise<{ token: string; userId: string; expiresAt: string }> {
    // Get org owner
    const orgResult = await this.fastify.db.query(
      `SELECT owner_id FROM organizations WHERE id = $1`,
      [orgId]
    );

    const ownerId = orgResult.rows[0]?.owner_id;
    if (!ownerId) {
      throw new Error('Organization has no owner');
    }

    // Get owner details
    const userResult = await this.fastify.db.query(
      `SELECT id, email FROM users WHERE id = $1`,
      [ownerId]
    );

    const user = userResult.rows[0];
    if (!user) {
      throw new Error('Owner user not found');
    }

    // Create short-lived impersonation token (15 minutes)
    const token = this.fastify.jwt.sign(
      { id: user.id, email: user.email, impersonated_by: adminId },
      { expiresIn: '15m' }
    );

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15);

    await this.logAction(
      adminId,
      adminEmail,
      'IMPERSONATE_USER',
      'user',
      ownerId,
      { organization_id: orgId },
      ipAddress
    );

    return { token, userId: ownerId, expiresAt: expiresAt.toISOString() };
  }

  // ==================== User Management ====================

  async listUsers(
    filters: UserFilters,
    pagination: Pagination
  ): Promise<PaginatedResult<UserDetails>> {
    const { page, limit } = pagination;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.search) {
      whereClause += ` AND (u.email ILIKE $${paramIndex} OR u.name ILIKE $${paramIndex})`;
      params.push(`%${filters.search}%`);
      paramIndex++;
    }

    if (filters.status === 'active') {
      whereClause += ` AND u.is_active = true`;
    } else if (filters.status === 'inactive') {
      whereClause += ` AND u.is_active = false`;
    }

    const sortBy = filters.sortBy || 'created_at';
    const sortOrder = filters.sortOrder || 'desc';
    const orderClause = `ORDER BY u.${sortBy} ${sortOrder}`;

    // Count total
    const countResult = await this.fastify.db.query(
      `SELECT COUNT(*) FROM users u ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count || '0');

    // Get users
    const result = await this.fastify.db.query(
      `SELECT u.id, u.email, u.name, u.capacity_week_hours, u.timezone, u.is_active, u.last_login_at, u.created_at, u.updated_at
      FROM users u
      ${whereClause}
      ${orderClause}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    // Get organizations for each user
    const usersWithOrgs: UserDetails[] = [];
    for (const user of result.rows) {
      const orgsResult = await this.fastify.db.query(
        `SELECT o.id, o.name, uor.role
        FROM user_organization_roles uor
        JOIN organizations o ON o.id = uor.organization_id
        WHERE uor.user_id = $1`,
        [user.id]
      );

      usersWithOrgs.push({
        ...user,
        organizations: orgsResult.rows,
      });
    }

    return {
      items: usersWithOrgs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUserDetails(userId: string): Promise<UserDetails | null> {
    const result = await this.fastify.db.query(
      `SELECT id, email, name, capacity_week_hours, timezone, is_active, last_login_at, created_at, updated_at
      FROM users WHERE id = $1`,
      [userId]
    );

    const user = result.rows[0];
    if (!user) return null;

    const orgsResult = await this.fastify.db.query(
      `SELECT o.id, o.name, uor.role
      FROM user_organization_roles uor
      JOIN organizations o ON o.id = uor.organization_id
      WHERE uor.user_id = $1`,
      [userId]
    );

    return {
      ...user,
      organizations: orgsResult.rows,
    };
  }

  async toggleUserActive(
    userId: string,
    active: boolean,
    adminId: string,
    adminEmail: string,
    ipAddress?: string
  ): Promise<void> {
    await this.fastify.db.query(
      `UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2`,
      [active, userId]
    );

    await this.logAction(
      adminId,
      adminEmail,
      active ? 'ENABLE_USER' : 'DISABLE_USER',
      'user',
      userId,
      undefined,
      ipAddress
    );
  }

  async deleteUser(
    userId: string,
    adminId: string,
    adminEmail: string,
    ipAddress?: string
  ): Promise<void> {
    await this.fastify.db.query(`DELETE FROM users WHERE id = $1`, [userId]);

    await this.logAction(adminId, adminEmail, 'DELETE_USER', 'user', userId, undefined, ipAddress);
  }

  // ==================== Audit Logs ====================

  async getAuditLogs(
    filters: AuditFilters,
    pagination: Pagination
  ): Promise<PaginatedResult<AdminAuditLog>> {
    const { page, limit } = pagination;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.adminId) {
      whereClause += ` AND admin_id = $${paramIndex}`;
      params.push(filters.adminId);
      paramIndex++;
    }

    if (filters.action) {
      whereClause += ` AND action = $${paramIndex}`;
      params.push(filters.action);
      paramIndex++;
    }

    if (filters.targetType) {
      whereClause += ` AND target_type = $${paramIndex}`;
      params.push(filters.targetType);
      paramIndex++;
    }

    if (filters.from) {
      whereClause += ` AND created_at >= $${paramIndex}`;
      params.push(filters.from);
      paramIndex++;
    }

    if (filters.to) {
      whereClause += ` AND created_at <= $${paramIndex}`;
      params.push(filters.to);
      paramIndex++;
    }

    // Count total
    const countResult = await this.fastify.db.query(
      `SELECT COUNT(*) FROM admin_audit_logs ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count || '0');

    // Get logs
    const result = await this.fastify.db.query<AdminAuditLog>(
      `SELECT * FROM admin_audit_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return {
      items: result.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async logAction(
    adminId: string,
    adminEmail: string,
    action: string,
    targetType?: string,
    targetId?: string,
    details?: Record<string, unknown>,
    ipAddress?: string
  ): Promise<void> {
    await this.fastify.db.query(
      `INSERT INTO admin_audit_logs (admin_id, admin_email, action, target_type, target_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [adminId, adminEmail, action, targetType || null, targetId || null, details ? JSON.stringify(details) : null, ipAddress || null]
    );
  }

  // ==================== Admin Management (OWNER only) ====================

  async listAdmins(): Promise<Omit<PlatformAdmin, 'failed_login_attempts' | 'locked_until'>[]> {
    const result = await this.fastify.db.query(
      `SELECT id, email, name, role, is_active, last_login_at, created_at, updated_at
       FROM platform_admins
       ORDER BY created_at DESC`
    );

    return result.rows;
  }

  async createAdmin(
    data: { email: string; password: string; name?: string; role: AdminRole },
    creatorId: string,
    creatorEmail: string,
    ipAddress?: string
  ): Promise<Omit<PlatformAdmin, 'failed_login_attempts' | 'locked_until'>> {
    const passwordHash = await hashPassword(data.password);

    const result = await this.fastify.db.query(
      `INSERT INTO platform_admins (email, password_hash, name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, role, is_active, last_login_at, created_at, updated_at`,
      [data.email, passwordHash, data.name || null, data.role]
    );

    const admin = result.rows[0];

    await this.logAction(creatorId, creatorEmail, 'CREATE_ADMIN', 'admin', admin.id, { email: data.email, role: data.role }, ipAddress);

    return admin;
  }

  async updateAdmin(
    adminId: string,
    data: { name?: string; role?: AdminRole; is_active?: boolean },
    updaterId: string,
    updaterEmail: string,
    ipAddress?: string
  ): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex}`);
      params.push(data.name);
      paramIndex++;
    }

    if (data.role !== undefined) {
      updates.push(`role = $${paramIndex}`);
      params.push(data.role);
      paramIndex++;
    }

    if (data.is_active !== undefined) {
      updates.push(`is_active = $${paramIndex}`);
      params.push(data.is_active);
      paramIndex++;
    }

    if (updates.length === 0) return;

    updates.push('updated_at = NOW()');
    params.push(adminId);

    await this.fastify.db.query(
      `UPDATE platform_admins SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      params
    );

    await this.logAction(updaterId, updaterEmail, 'UPDATE_ADMIN', 'admin', adminId, data, ipAddress);
  }

  async deleteAdmin(
    adminId: string,
    deleterId: string,
    deleterEmail: string,
    ipAddress?: string
  ): Promise<void> {
    // Don't allow deleting self
    if (adminId === deleterId) {
      throw new Error('Cannot delete yourself');
    }

    await this.fastify.db.query(`DELETE FROM platform_admins WHERE id = $1`, [adminId]);

    await this.logAction(deleterId, deleterEmail, 'DELETE_ADMIN', 'admin', adminId, undefined, ipAddress);
  }
}
