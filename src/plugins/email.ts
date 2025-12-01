import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { EmailService } from '../services/emailService.js';

declare module 'fastify' {
  interface FastifyInstance {
    emailService: EmailService;
  }
}

async function emailPlugin(fastify: FastifyInstance) {
  const emailService = new EmailService(fastify.config);
  fastify.decorate('emailService', emailService);

  if (emailService.isConfigured()) {
    fastify.log.info('Email service configured with Resend');
  } else {
    fastify.log.warn('Email service not configured - RESEND_API_KEY not set');
  }
}

export default fp(emailPlugin, {
  name: 'email',
  dependencies: ['env'],
});
