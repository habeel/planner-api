import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

async function rateLimitPlugin(fastify: FastifyInstance) {
  await fastify.register(rateLimit, {
    global: true,
    max: 100, // 100 requests per minute globally
    timeWindow: '1 minute',
    // Custom key generator for authenticated users
    keyGenerator: (request) => {
      return request.user?.id || request.ip;
    },
    // Skip rate limiting for health check
    allowList: (request) => {
      return request.url === '/health';
    },
    // Custom error response
    errorResponseBuilder: (request, context) => {
      return {
        error: `Rate limit exceeded. Try again in ${Math.round(context.ttl / 1000)} seconds.`,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.round(context.ttl / 1000),
      };
    },
  });

  // Stricter rate limit for auth endpoints
  fastify.addHook('onRoute', (routeOptions) => {
    if (routeOptions.url?.startsWith('/api/auth')) {
      routeOptions.config = {
        ...routeOptions.config,
        rateLimit: {
          max: 10, // 10 requests per minute for auth
          timeWindow: '1 minute',
        },
      };
    }
  });

  fastify.log.info('Rate limiting enabled');
}

export default fp(rateLimitPlugin, {
  name: 'rateLimit',
  dependencies: ['env'],
});
