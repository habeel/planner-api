import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { BillingService } from '../services/billingService.js';
import { OrganizationService } from '../services/organizationService.js';
import type { OrganizationRole } from '../types/index.js';

const checkoutSchema = z.object({
  plan: z.enum(['starter', 'pro']),
  success_url: z.string().url(),
  cancel_url: z.string().url(),
});

const portalSchema = z.object({
  return_url: z.string().url(),
});

export default async function billingRoutes(fastify: FastifyInstance) {
  const billingService = new BillingService(fastify);
  const orgService = new OrganizationService(fastify);

  // All routes require authentication
  fastify.addHook('onRequest', fastify.authenticate);

  // Helper to check org access
  async function checkOrgAccess(
    userId: string,
    orgId: string,
    requiredRoles?: OrganizationRole[]
  ): Promise<{ allowed: boolean; role: OrganizationRole | null }> {
    const role = await orgService.getUserRole(orgId, userId);
    if (!role) {
      return { allowed: false, role: null };
    }
    if (requiredRoles && !requiredRoles.includes(role)) {
      return { allowed: false, role };
    }
    return { allowed: true, role };
  }

  // Check if Stripe is configured
  fastify.addHook('preHandler', async (request, reply) => {
    // Skip check for webhook route (handled separately)
    if (request.url.includes('/webhooks/')) return;

    if (!billingService.isConfigured()) {
      return reply.status(503).send({
        error: 'Billing is not configured',
        code: 'BILLING_NOT_CONFIGURED',
      });
    }
  });

  // POST /api/billing/organizations/:orgId/checkout - Create checkout session
  fastify.post<{ Params: { orgId: string } }>(
    '/organizations/:orgId/checkout',
    async (request, reply) => {
      const { orgId } = request.params;
      const userId = request.user.id;

      // Only OWNER can manage billing
      const { allowed, role } = await checkOrgAccess(userId, orgId, ['OWNER']);
      if (!allowed) {
        return reply.status(403).send({
          error: role ? 'Only the owner can manage billing' : 'You do not have access to this organization',
          code: 'FORBIDDEN',
        });
      }

      const parseResult = checkoutSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { plan, success_url, cancel_url } = parseResult.data;

      // Get price ID for selected plan
      const priceId = plan === 'starter'
        ? fastify.config.STRIPE_PRICE_STARTER
        : fastify.config.STRIPE_PRICE_PRO;

      if (!priceId) {
        return reply.status(503).send({
          error: `Price for ${plan} plan is not configured`,
          code: 'PRICE_NOT_CONFIGURED',
        });
      }

      // Get current seat count
      const seatCount = await billingService.getSeatCount(orgId);

      const session = await billingService.createCheckoutSession({
        organizationId: orgId,
        priceId,
        quantity: Math.max(1, seatCount), // At least 1 seat
        successUrl: success_url,
        cancelUrl: cancel_url,
      });

      return reply.send({
        checkout_url: session.url,
        session_id: session.id,
      });
    }
  );

  // POST /api/billing/organizations/:orgId/portal - Create customer portal session
  fastify.post<{ Params: { orgId: string } }>(
    '/organizations/:orgId/portal',
    async (request, reply) => {
      const { orgId } = request.params;
      const userId = request.user.id;

      // Only OWNER can access billing portal
      const { allowed, role } = await checkOrgAccess(userId, orgId, ['OWNER']);
      if (!allowed) {
        return reply.status(403).send({
          error: role ? 'Only the owner can access billing' : 'You do not have access to this organization',
          code: 'FORBIDDEN',
        });
      }

      const parseResult = portalSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          code: 'INVALID_INPUT',
          details: parseResult.error.flatten(),
        });
      }

      const { return_url } = parseResult.data;

      try {
        const session = await billingService.createPortalSession(orgId, return_url);
        return reply.send({
          portal_url: session.url,
        });
      } catch (err) {
        if ((err as Error).message.includes('does not have a Stripe customer')) {
          return reply.status(400).send({
            error: 'No billing account exists. Subscribe to a plan first.',
            code: 'NO_BILLING_ACCOUNT',
          });
        }
        throw err;
      }
    }
  );

  // GET /api/billing/organizations/:orgId/subscription - Get subscription details
  fastify.get<{ Params: { orgId: string } }>(
    '/organizations/:orgId/subscription',
    async (request, reply) => {
      const { orgId } = request.params;
      const userId = request.user.id;

      // Any member can view subscription info
      const { allowed } = await checkOrgAccess(userId, orgId);
      if (!allowed) {
        return reply.status(403).send({
          error: 'You do not have access to this organization',
          code: 'FORBIDDEN',
        });
      }

      const org = await orgService.getById(orgId);
      if (!org) {
        return reply.status(404).send({
          error: 'Organization not found',
          code: 'NOT_FOUND',
        });
      }

      const subscription = await billingService.getSubscriptionInfo(orgId);
      const usage = await orgService.getUsage(orgId);

      return reply.send({
        plan: org.plan,
        plan_limits: org.plan_limits,
        subscription_status: org.subscription_status,
        subscription: subscription,
        usage,
      });
    }
  );

  // POST /api/billing/organizations/:orgId/cancel - Cancel subscription
  fastify.post<{ Params: { orgId: string } }>(
    '/organizations/:orgId/cancel',
    async (request, reply) => {
      const { orgId } = request.params;
      const userId = request.user.id;

      // Only OWNER can cancel subscription
      const { allowed, role } = await checkOrgAccess(userId, orgId, ['OWNER']);
      if (!allowed) {
        return reply.status(403).send({
          error: role ? 'Only the owner can cancel the subscription' : 'You do not have access to this organization',
          code: 'FORBIDDEN',
        });
      }

      const org = await orgService.getById(orgId);
      if (!org?.stripe_subscription_id) {
        return reply.status(400).send({
          error: 'No active subscription to cancel',
          code: 'NO_SUBSCRIPTION',
        });
      }

      await billingService.cancelSubscription(org.stripe_subscription_id);

      return reply.send({
        success: true,
        message: 'Subscription will be canceled at the end of the billing period',
      });
    }
  );

  // POST /api/billing/organizations/:orgId/reactivate - Reactivate canceled subscription
  fastify.post<{ Params: { orgId: string } }>(
    '/organizations/:orgId/reactivate',
    async (request, reply) => {
      const { orgId } = request.params;
      const userId = request.user.id;

      // Only OWNER can reactivate subscription
      const { allowed, role } = await checkOrgAccess(userId, orgId, ['OWNER']);
      if (!allowed) {
        return reply.status(403).send({
          error: role ? 'Only the owner can reactivate the subscription' : 'You do not have access to this organization',
          code: 'FORBIDDEN',
        });
      }

      const org = await orgService.getById(orgId);
      if (!org?.stripe_subscription_id) {
        return reply.status(400).send({
          error: 'No subscription to reactivate',
          code: 'NO_SUBSCRIPTION',
        });
      }

      await billingService.reactivateSubscription(org.stripe_subscription_id);

      return reply.send({
        success: true,
        message: 'Subscription reactivated',
      });
    }
  );
}

// Separate route for Stripe webhooks (no auth, raw body)
export async function stripeWebhookRoutes(fastify: FastifyInstance) {
  const billingService = new BillingService(fastify);

  // Need to get raw body for webhook signature verification
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body);
    }
  );

  // POST /api/webhooks/stripe - Stripe webhook handler
  fastify.post('/stripe', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!billingService.isConfigured()) {
      return reply.status(503).send({
        error: 'Billing is not configured',
        code: 'BILLING_NOT_CONFIGURED',
      });
    }

    const signature = request.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') {
      return reply.status(400).send({
        error: 'Missing Stripe signature',
        code: 'MISSING_SIGNATURE',
      });
    }

    try {
      const event = billingService.constructWebhookEvent(
        request.body as Buffer,
        signature
      );

      await billingService.handleWebhookEvent(event);

      return reply.send({ received: true });
    } catch (err) {
      console.error('Webhook error:', err);
      return reply.status(400).send({
        error: 'Webhook verification failed',
        code: 'WEBHOOK_ERROR',
      });
    }
  });
}
