import type { FastifyInstance } from 'fastify';
import type {
  Organization,
  OrganizationRole,
  OrganizationMember,
  OrganizationUsage,
  PlanLimits,
  PlanType,
} from '../types/index.js';

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  owner_id: string;
  billing_email?: string;
}

export interface UpdateOrganizationInput {
  name?: string;
  slug?: string;
  billing_email?: string;
}

const DEFAULT_PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  free: { max_users: 3, max_workspaces: 1, max_integrations: 0 },
  starter: { max_users: -1, max_workspaces: 3, max_integrations: 3 },
  pro: { max_users: -1, max_workspaces: -1, max_integrations: -1 },
  enterprise: { max_users: -1, max_workspaces: -1, max_integrations: -1 },
};

export class OrganizationService {
  constructor(private fastify: FastifyInstance) {}

  async create(input: CreateOrganizationInput): Promise<Organization> {
    const planLimits = DEFAULT_PLAN_LIMITS.free;

    const result = await this.fastify.db.query<Organization>(
      `INSERT INTO organizations (name, slug, owner_id, billing_email, plan, plan_limits)
       VALUES ($1, $2, $3, $4, 'free', $5)
       RETURNING *`,
      [input.name, input.slug, input.owner_id, input.billing_email || null, JSON.stringify(planLimits)]
    );

    const org = result.rows[0]!;

    // Add owner as OWNER role
    await this.addMember(org.id, input.owner_id, 'OWNER');

    return org;
  }

  async getById(id: string): Promise<Organization | null> {
    const result = await this.fastify.db.query<Organization>(
      `SELECT * FROM organizations WHERE id = $1 AND is_active = true`,
      [id]
    );
    return result.rows[0] || null;
  }

  async getBySlug(slug: string): Promise<Organization | null> {
    const result = await this.fastify.db.query<Organization>(
      `SELECT * FROM organizations WHERE slug = $1 AND is_active = true`,
      [slug]
    );
    return result.rows[0] || null;
  }

  async update(id: string, input: UpdateOrganizationInput): Promise<Organization | null> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(input.name);
    }
    if (input.slug !== undefined) {
      updates.push(`slug = $${paramIndex++}`);
      values.push(input.slug);
    }
    if (input.billing_email !== undefined) {
      updates.push(`billing_email = $${paramIndex++}`);
      values.push(input.billing_email);
    }

    if (updates.length === 0) {
      return this.getById(id);
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await this.fastify.db.query<Organization>(
      `UPDATE organizations SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND is_active = true
       RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  async delete(id: string): Promise<boolean> {
    // Soft delete
    const result = await this.fastify.db.query(
      `UPDATE organizations SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND is_active = true`,
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  // Membership methods
  async addMember(orgId: string, userId: string, role: OrganizationRole): Promise<void> {
    // Check if user is already a member (to avoid double-counting seats)
    const existingRole = await this.getUserRole(orgId, userId);
    const isNewMember = !existingRole;

    await this.fastify.db.query(
      `INSERT INTO user_organization_roles (organization_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = $3`,
      [orgId, userId, role]
    );

    // Sync seat count with Stripe if this is a new member on a paid plan
    if (isNewMember) {
      await this.syncSeatCount(orgId);
    }
  }

  async removeMember(orgId: string, userId: string): Promise<boolean> {
    const result = await this.fastify.db.query(
      `DELETE FROM user_organization_roles
       WHERE organization_id = $1 AND user_id = $2`,
      [orgId, userId]
    );

    const removed = (result.rowCount ?? 0) > 0;

    // Sync seat count with Stripe after removal
    if (removed) {
      await this.syncSeatCount(orgId);
    }

    return removed;
  }

  private async syncSeatCount(orgId: string): Promise<void> {
    // Import dynamically to avoid circular dependency
    const { BillingService } = await import('./billingService.js');
    const billingService = new BillingService(this.fastify);

    // Only sync if Stripe is configured and org has an active subscription
    if (!billingService.isConfigured()) return;

    const org = await this.getById(orgId);
    if (!org || org.plan === 'free' || !org.stripe_subscription_id) return;

    try {
      const seatCount = await billingService.getSeatCount(orgId);
      await billingService.updateSeatCount(org.stripe_subscription_id, Math.max(1, seatCount));
    } catch (err) {
      // Log error but don't fail the member operation
      console.error('Failed to sync seat count with Stripe:', err);
    }
  }

  async updateMemberRole(orgId: string, userId: string, role: OrganizationRole): Promise<boolean> {
    const result = await this.fastify.db.query(
      `UPDATE user_organization_roles SET role = $3
       WHERE organization_id = $1 AND user_id = $2`,
      [orgId, userId, role]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getUserRole(orgId: string, userId: string): Promise<OrganizationRole | null> {
    const result = await this.fastify.db.query<{ role: OrganizationRole }>(
      `SELECT role FROM user_organization_roles
       WHERE organization_id = $1 AND user_id = $2`,
      [orgId, userId]
    );
    return result.rows[0]?.role || null;
  }

  async getMembers(orgId: string): Promise<OrganizationMember[]> {
    const result = await this.fastify.db.query<OrganizationMember>(
      `SELECT
         uor.user_id,
         u.email,
         u.name,
         uor.role,
         uor.created_at
       FROM user_organization_roles uor
       JOIN users u ON uor.user_id = u.id
       WHERE uor.organization_id = $1 AND u.is_active = true
       ORDER BY uor.created_at`,
      [orgId]
    );
    return result.rows;
  }

  async getUserOrganizations(userId: string): Promise<Organization[]> {
    const result = await this.fastify.db.query<Organization>(
      `SELECT o.*, u.email as owner_email, u.name as owner_name
       FROM organizations o
       JOIN user_organization_roles uor ON o.id = uor.organization_id
       LEFT JOIN users u ON o.owner_id = u.id
       WHERE uor.user_id = $1 AND o.is_active = true
       ORDER BY o.name`,
      [userId]
    );
    return result.rows;
  }

  async countUserOwnedFreeOrganizations(userId: string): Promise<number> {
    const result = await this.fastify.db.query<{ count: string }>(
      `SELECT COUNT(*)::integer as count
       FROM organizations
       WHERE owner_id = $1 AND plan = 'free' AND is_active = true`,
      [userId]
    );
    return parseInt(result.rows[0]?.count || '0', 10);
  }

  // Plan limit methods
  async getUsage(orgId: string): Promise<OrganizationUsage> {
    // Count users
    const usersResult = await this.fastify.db.query<{ count: string }>(
      `SELECT COUNT(*)::integer as count
       FROM user_organization_roles
       WHERE organization_id = $1`,
      [orgId]
    );

    // Count workspaces
    const workspacesResult = await this.fastify.db.query<{ count: string }>(
      `SELECT COUNT(*)::integer as count
       FROM workspaces
       WHERE organization_id = $1`,
      [orgId]
    );

    // Count integrations (across all workspaces)
    const integrationsResult = await this.fastify.db.query<{ count: string }>(
      `SELECT COUNT(*)::integer as count
       FROM integrations i
       JOIN workspaces w ON i.workspace_id = w.id
       WHERE w.organization_id = $1`,
      [orgId]
    );

    // Count tasks (across all workspaces)
    const tasksResult = await this.fastify.db.query<{ count: string }>(
      `SELECT COUNT(*)::integer as count
       FROM tasks t
       JOIN workspaces w ON t.workspace_id = w.id
       WHERE w.organization_id = $1`,
      [orgId]
    );

    return {
      users: parseInt(usersResult.rows[0]?.count || '0', 10),
      workspaces: parseInt(workspacesResult.rows[0]?.count || '0', 10),
      integrations: parseInt(integrationsResult.rows[0]?.count || '0', 10),
      tasks: parseInt(tasksResult.rows[0]?.count || '0', 10),
    };
  }

  async checkLimit(
    orgId: string,
    limitType: 'max_users' | 'max_workspaces' | 'max_integrations'
  ): Promise<{ allowed: boolean; current: number; max: number }> {
    const org = await this.getById(orgId);
    if (!org) {
      return { allowed: false, current: 0, max: 0 };
    }

    const usage = await this.getUsage(orgId);
    const limits = org.plan_limits as PlanLimits;
    const max = limits[limitType];

    let current: number;
    switch (limitType) {
      case 'max_users':
        current = usage.users;
        break;
      case 'max_workspaces':
        current = usage.workspaces;
        break;
      case 'max_integrations':
        current = usage.integrations;
        break;
    }

    // -1 means unlimited
    const allowed = max === -1 || current < max;

    return { allowed, current, max };
  }

  // Slug helpers
  async isSlugAvailable(slug: string, excludeOrgId?: string): Promise<boolean> {
    const query = excludeOrgId
      ? `SELECT id FROM organizations WHERE slug = $1 AND id != $2`
      : `SELECT id FROM organizations WHERE slug = $1`;

    const params = excludeOrgId ? [slug, excludeOrgId] : [slug];
    const result = await this.fastify.db.query(query, params);

    return result.rows.length === 0;
  }

  generateSlug(name: string): string {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 90);
    // Add random suffix to ensure uniqueness
    const suffix = Math.random().toString(36).substring(2, 8);
    return `${base}-${suffix}`;
  }

  // Stripe-related updates
  async updateStripeCustomerId(orgId: string, customerId: string): Promise<void> {
    await this.fastify.db.query(
      `UPDATE organizations SET stripe_customer_id = $2, updated_at = NOW()
       WHERE id = $1`,
      [orgId, customerId]
    );
  }

  async updateSubscription(
    orgId: string,
    subscriptionId: string | null,
    status: string,
    currentPeriodEnd: Date | null,
    plan?: PlanType
  ): Promise<void> {
    const planLimits = plan ? JSON.stringify(DEFAULT_PLAN_LIMITS[plan]) : null;

    if (plan && planLimits) {
      await this.fastify.db.query(
        `UPDATE organizations
         SET stripe_subscription_id = $2,
             subscription_status = $3,
             current_period_end = $4,
             plan = $5,
             plan_limits = $6,
             updated_at = NOW()
         WHERE id = $1`,
        [orgId, subscriptionId, status, currentPeriodEnd, plan, planLimits]
      );
    } else {
      await this.fastify.db.query(
        `UPDATE organizations
         SET stripe_subscription_id = $2,
             subscription_status = $3,
             current_period_end = $4,
             updated_at = NOW()
         WHERE id = $1`,
        [orgId, subscriptionId, status, currentPeriodEnd]
      );
    }
  }
}
