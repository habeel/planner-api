import fp from 'fastify-plugin';
import { loadConfig } from '../config/index.js';
async function envPlugin(fastify) {
    const config = loadConfig();
    fastify.decorate('config', config);
}
export default fp(envPlugin, {
    name: 'env',
});
//# sourceMappingURL=env.js.map