import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

async function corsPlugin(fastify: FastifyInstance) {
  const isProduction = fastify.config.NODE_ENV === 'production';

  await fastify.register(cors, {
    // In production, only allow requests from APP_URL
    // In development, allow all origins
    origin: isProduction ? fastify.config.APP_URL : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  if (isProduction) {
    fastify.log.info(`CORS restricted to origin: ${fastify.config.APP_URL}`);
  } else {
    fastify.log.info('CORS allowing all origins (development mode)');
  }
}

export default fp(corsPlugin, {
  name: 'cors',
  dependencies: ['env'],
});
