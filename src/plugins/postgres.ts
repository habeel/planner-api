import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createPool, type DbPool } from '../db/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: DbPool;
  }
}

async function postgresPlugin(fastify: FastifyInstance) {
  const pool = createPool(fastify.config);

  // Test connection
  try {
    const client = await pool.connect();
    fastify.log.info('Connected to PostgreSQL');
    client.release();
  } catch (err) {
    fastify.log.error({ err }, 'Failed to connect to PostgreSQL');
    throw err;
  }

  fastify.decorate('db', pool);

  fastify.addHook('onClose', async () => {
    await pool.end();
    fastify.log.info('PostgreSQL connection closed');
  });
}

export default fp(postgresPlugin, {
  name: 'postgres',
  dependencies: ['env'],
});
