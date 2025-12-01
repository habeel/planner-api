import fp from 'fastify-plugin';
import { createPool } from '../db/index.js';
async function postgresPlugin(fastify) {
    const pool = createPool(fastify.config);
    // Test connection
    try {
        const client = await pool.connect();
        fastify.log.info('Connected to PostgreSQL');
        client.release();
    }
    catch (err) {
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
//# sourceMappingURL=postgres.js.map