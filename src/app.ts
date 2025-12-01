import Fastify from 'fastify';
import { envPlugin, corsPlugin, postgresPlugin, authPlugin, emailPlugin, rateLimitPlugin, helmetPlugin } from './plugins/index.js';
import {
  authRoutes,
  userRoutes,
  workspaceRoutes,
  taskRoutes,
  timeEntryRoutes,
  planningRoutes,
  integrationRoutes,
  reportRoutes,
  organizationRoutes,
  invitationRoutes,
  billingRoutes,
  stripeWebhookRoutes,
} from './routes/index.js';

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    },
  });

  // Register plugins in order
  await fastify.register(envPlugin);
  await fastify.register(helmetPlugin);
  await fastify.register(rateLimitPlugin);
  await fastify.register(corsPlugin);
  await fastify.register(postgresPlugin);
  await fastify.register(authPlugin);
  await fastify.register(emailPlugin);

  // Register routes with /api prefix
  await fastify.register(authRoutes, { prefix: '/api/auth' });
  await fastify.register(userRoutes, { prefix: '/api/users' });
  await fastify.register(organizationRoutes, { prefix: '/api/organizations' });
  await fastify.register(invitationRoutes, { prefix: '/api/invitations' });
  await fastify.register(billingRoutes, { prefix: '/api/billing' });
  await fastify.register(stripeWebhookRoutes, { prefix: '/api/webhooks' });
  await fastify.register(workspaceRoutes, { prefix: '/api/workspaces' });
  await fastify.register(taskRoutes, { prefix: '/api/tasks' });
  await fastify.register(timeEntryRoutes, { prefix: '/api/tasks' });
  await fastify.register(planningRoutes, { prefix: '/api/planning' });
  await fastify.register(integrationRoutes, { prefix: '/api/integrations' });
  await fastify.register(reportRoutes, { prefix: '/api/workspaces' });

  // Health check endpoint
  fastify.get('/health', async (request, reply) => {
    try {
      // Check database connectivity
      await fastify.db.query('SELECT 1');
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
          database: 'healthy',
          email: fastify.emailService.isConfigured() ? 'configured' : 'not configured',
        },
      };
    } catch (error) {
      reply.status(503);
      return {
        status: 'error',
        timestamp: new Date().toISOString(),
        services: {
          database: 'unhealthy',
        },
      };
    }
  });

  return fastify;
}
