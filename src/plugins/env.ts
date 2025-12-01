import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { loadConfig, type Env } from '../config/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Env;
  }
}

async function envPlugin(fastify: FastifyInstance) {
  const config = loadConfig();
  fastify.decorate('config', config);
}

export default fp(envPlugin, {
  name: 'env',
});
