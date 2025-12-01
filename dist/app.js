import Fastify from 'fastify';
import { envPlugin, corsPlugin, postgresPlugin, authPlugin } from './plugins/index.js';
import { authRoutes, userRoutes, workspaceRoutes, taskRoutes, planningRoutes, integrationRoutes, } from './routes/index.js';
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
    await fastify.register(corsPlugin);
    await fastify.register(postgresPlugin);
    await fastify.register(authPlugin);
    // Register routes with /api prefix
    await fastify.register(authRoutes, { prefix: '/api/auth' });
    await fastify.register(userRoutes, { prefix: '/api/users' });
    await fastify.register(workspaceRoutes, { prefix: '/api/workspaces' });
    await fastify.register(taskRoutes, { prefix: '/api/tasks' });
    await fastify.register(planningRoutes, { prefix: '/api/planning' });
    await fastify.register(integrationRoutes, { prefix: '/api/integrations' });
    // Health check endpoint
    fastify.get('/health', async () => {
        return { status: 'ok', timestamp: new Date().toISOString() };
    });
    return fastify;
}
//# sourceMappingURL=app.js.map