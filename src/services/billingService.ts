import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import type { PlanType, PlanLimits } from '../types/index.js';

export interface CheckoutSessionInput {
  organizationId: string;
  priceId: string;
  quantity: number;
  successUrl: string;
  cancelUrl: string;
}

export interface SubscriptionInfo {
  id: string;
  status: string;
  plan: PlanType;
  quantity: number;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
}

const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  free: { max_users: 3, max_workspaces: 1, max_integrations: 0 },
  starter: { max_users: -1, max_workspaces: 3, max_integrations: 3 },
  pro: { max_users: -1, max_workspaces: -1, max_integrations: -1 },
  enterprise: { max_users: -1, max_workspaces: -1, max_integrations: -1 },
};

export class BillingService {
  private stripe: Stripe | null = null;

  constructor(private fastify: FastifyInstance) {
    const secretKey = this.fastify.config.STRIPE_SECRET_KEY;
    if (secretKey) {
      this.stripe = new Stripe(secretKey, {
        apiVersion: '2025-11-17.clover',
      });
    }
  }

  private ensureStripe(): Stripe {
    if (!this.stripe) {
      throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY environment variable.');
    }
    return this.stripe;
  }

  isConfigured(): boolean {
    return this.stripe !== null;
  }

  // Customer Management
  async createCustomer(
    organizationId: string,
    email: string,
    name: string
  ): Promise<Stripe.Customer> {
    const stripe = this.ensureStripe();

    const customer = await stripe.customers.create({
      email,
      name,
      metadata: {
        organization_id: organizationId,
      },
    });

    // Update organization with Stripe customer ID
    await this.fastify.db.query(
      `UPDATE organizations SET stripe_customer_id = $2, updated_at = NOW() WHERE id = $1`,
      [organizationId, customer.id]
    );

    return customer;
  }

  async getCustomer(customerId: string): Promise<Stripe.Customer | null> {
    const stripe = this.ensureStripe();

    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (customer.deleted) return null;
      return customer as Stripe.Customer;
    } catch {
      return null;
    }
  }

  async getOrCreateCustomer(
    organizationId: string,
    email: string,
    name: string
  ): Promise<Stripe.Customer> {
    // Check if org already has a Stripe customer
    const result = await this.fastify.db.query<{ stripe_customer_id: string | null }>(
      `SELECT stripe_customer_id FROM organizations WHERE id = $1`,
      [organizationId]
    );

    const customerId = result.rows[0]?.stripe_customer_id;
    if (customerId) {
      const customer = await this.getCustomer(customerId);
      if (customer) return customer;
    }

    // Create new customer
    return this.createCustomer(organizationId, email, name);
  }

  // Checkout & Portal Sessions
  async createCheckoutSession(input: CheckoutSessionInput): Promise<Stripe.Checkout.Session> {
    const stripe = this.ensureStripe();

    // Get organization details
    const orgResult = await this.fastify.db.query<{
      name: string;
      billing_email: string | null;
      stripe_customer_id: string | null;
    }>(
      `SELECT name, billing_email, stripe_customer_id FROM organizations WHERE id = $1`,
      [input.organizationId]
    );

    const org = orgResult.rows[0];
    if (!org) {
      throw new Error('Organization not found');
    }

    // Get or create Stripe customer
    const customer = await this.getOrCreateCustomer(
      input.organizationId,
      org.billing_email || '',
      org.name
    );

    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      mode: 'subscription',
      line_items: [
        {
          price: input.priceId,
          quantity: input.quantity,
        },
      ],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      subscription_data: {
        metadata: {
          organization_id: input.organizationId,
        },
      },
      metadata: {
        organization_id: input.organizationId,
      },
    });

    return session;
  }

  async createPortalSession(
    organizationId: string,
    returnUrl: string
  ): Promise<Stripe.BillingPortal.Session> {
    const stripe = this.ensureStripe();

    // Get organization's Stripe customer ID
    const result = await this.fastify.db.query<{ stripe_customer_id: string | null }>(
      `SELECT stripe_customer_id FROM organizations WHERE id = $1`,
      [organizationId]
    );

    const customerId = result.rows[0]?.stripe_customer_id;
    if (!customerId) {
      throw new Error('Organization does not have a Stripe customer');
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return session;
  }

  // Subscription Management
  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription | null> {
    const stripe = this.ensureStripe();

    try {
      return await stripe.subscriptions.retrieve(subscriptionId);
    } catch {
      return null;
    }
  }

  async updateSeatCount(subscriptionId: string, newQuantity: number): Promise<Stripe.Subscription> {
    const stripe = this.ensureStripe();

    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const itemId = subscription.items.data[0]?.id;

    if (!itemId) {
      throw new Error('Subscription has no items');
    }

    return stripe.subscriptions.update(subscriptionId, {
      items: [
        {
          id: itemId,
          quantity: newQuantity,
        },
      ],
      proration_behavior: 'create_prorations',
    });
  }

  async cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    const stripe = this.ensureStripe();

    return stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
  }

  async reactivateSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    const stripe = this.ensureStripe();

    return stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false,
    });
  }

  // Get subscription info for API responses
  async getSubscriptionInfo(organizationId: string): Promise<SubscriptionInfo | null> {
    const result = await this.fastify.db.query<{
      stripe_subscription_id: string | null;
      subscription_status: string;
      plan: PlanType;
      current_period_end: Date | null;
    }>(
      `SELECT stripe_subscription_id, subscription_status, plan, current_period_end
       FROM organizations WHERE id = $1`,
      [organizationId]
    );

    const org = result.rows[0];
    if (!org || !org.stripe_subscription_id) {
      return null;
    }

    // Get quantity from Stripe
    const subscription = await this.getSubscription(org.stripe_subscription_id);
    const quantity = subscription?.items.data[0]?.quantity || 0;

    return {
      id: org.stripe_subscription_id,
      status: org.subscription_status,
      plan: org.plan,
      quantity,
      currentPeriodEnd: org.current_period_end || new Date(),
      cancelAtPeriodEnd: subscription?.cancel_at_period_end || false,
    };
  }

  // Webhook Handling
  constructWebhookEvent(payload: string | Buffer, signature: string): Stripe.Event {
    const stripe = this.ensureStripe();
    const webhookSecret = this.fastify.config.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      throw new Error('Stripe webhook secret not configured');
    }

    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }

  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.handleSubscriptionUpdate(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.handleSubscriptionDeleted(subscription);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = typeof invoice.parent?.subscription_details?.subscription === 'string'
          ? invoice.parent.subscription_details.subscription
          : invoice.parent?.subscription_details?.subscription?.id;
        if (subId) {
          await this.handlePaymentFailed(subId);
        }
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = typeof invoice.parent?.subscription_details?.subscription === 'string'
          ? invoice.parent.subscription_details.subscription
          : invoice.parent?.subscription_details?.subscription?.id;
        if (subId) {
          await this.handlePaymentSucceeded(subId);
        }
        break;
      }

      default:
        // Ignore other events
        break;
    }
  }

  private async handleSubscriptionUpdate(subscription: Stripe.Subscription): Promise<void> {
    const organizationId = subscription.metadata.organization_id;
    if (!organizationId) {
      console.error('Subscription missing organization_id in metadata:', subscription.id);
      return;
    }

    // Determine plan from price
    const priceId = subscription.items.data[0]?.price.id;
    const plan = this.getPlanFromPriceId(priceId);
    const planLimits = PLAN_LIMITS[plan];

    // Get current period end from the subscription items
    const currentPeriodEnd = subscription.items.data[0]?.current_period_end;

    await this.fastify.db.query(
      `UPDATE organizations
       SET stripe_subscription_id = $2,
           subscription_status = $3,
           current_period_end = $4,
           plan = $5,
           plan_limits = $6,
           updated_at = NOW()
       WHERE id = $1`,
      [
        organizationId,
        subscription.id,
        subscription.status,
        currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
        plan,
        JSON.stringify(planLimits),
      ]
    );
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const organizationId = subscription.metadata.organization_id;
    if (!organizationId) return;

    // Downgrade to free plan
    const freeLimits = PLAN_LIMITS.free;

    await this.fastify.db.query(
      `UPDATE organizations
       SET stripe_subscription_id = NULL,
           subscription_status = 'canceled',
           current_period_end = NULL,
           plan = 'free',
           plan_limits = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [organizationId, JSON.stringify(freeLimits)]
    );
  }

  private async handlePaymentFailed(subscriptionId: string): Promise<void> {
    await this.fastify.db.query(
      `UPDATE organizations
       SET subscription_status = 'past_due',
           updated_at = NOW()
       WHERE stripe_subscription_id = $1`,
      [subscriptionId]
    );
  }

  private async handlePaymentSucceeded(subscriptionId: string): Promise<void> {
    await this.fastify.db.query(
      `UPDATE organizations
       SET subscription_status = 'active',
           updated_at = NOW()
       WHERE stripe_subscription_id = $1`,
      [subscriptionId]
    );
  }

  private getPlanFromPriceId(priceId: string | undefined): PlanType {
    if (!priceId) return 'free';

    const starterPriceId = this.fastify.config.STRIPE_PRICE_STARTER;
    const proPriceId = this.fastify.config.STRIPE_PRICE_PRO;

    if (priceId === starterPriceId) return 'starter';
    if (priceId === proPriceId) return 'pro';

    // Default to starter if price doesn't match (shouldn't happen)
    return 'starter';
  }

  // Helper: Get current seat count for an organization
  async getSeatCount(organizationId: string): Promise<number> {
    const result = await this.fastify.db.query<{ count: string }>(
      `SELECT COUNT(*)::integer as count
       FROM user_organization_roles
       WHERE organization_id = $1`,
      [organizationId]
    );

    return parseInt(result.rows[0]?.count || '0', 10);
  }
}
