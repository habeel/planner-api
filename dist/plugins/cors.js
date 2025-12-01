import fp from 'fastify-plugin';
import cors from '@fastify/cors';
async function corsPlugin(fastify) {
    await fastify.register(cors, {
        origin: true, // Allow all origins in development
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    });
}
export default fp(corsPlugin, {
    name: 'cors',
});
//# sourceMappingURL=cors.js.map