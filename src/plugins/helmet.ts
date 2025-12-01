import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';

async function helmetPlugin(fastify: FastifyInstance) {
  await fastify.register(helmet, {
    // Content Security Policy
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for UI
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https://api.stripe.com'], // Allow Stripe API
        frameSrc: ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'], // Stripe iframe
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    // Cross-Origin settings
    crossOriginEmbedderPolicy: false, // Allow embedding (for Stripe)
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, // Allow Stripe popups
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow cross-origin resources
    // Other security headers
    dnsPrefetchControl: { allow: false },
    frameguard: { action: 'sameorigin' },
    hidePoweredBy: true,
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
    ieNoOpen: true,
    noSniff: true,
    originAgentCluster: true,
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xssFilter: true,
  });

  fastify.log.info('Security headers enabled (helmet)');
}

export default fp(helmetPlugin, {
  name: 'helmet',
  dependencies: ['env'],
});
