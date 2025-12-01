import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
async function authPlugin(fastify) {
    await fastify.register(jwt, {
        secret: fastify.config.JWT_SECRET,
        sign: {
            expiresIn: '15m', // Short-lived access token
        },
    });
    fastify.decorate('authenticate', async function (request, reply) {
        try {
            await request.jwtVerify();
        }
        catch (err) {
            reply.status(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        }
    });
}
export default fp(authPlugin, {
    name: 'auth',
    dependencies: ['env'],
});
//# sourceMappingURL=auth.js.map