import { config } from 'dotenv';
config();
import { buildApp } from './app.js';
async function start() {
    const app = await buildApp();
    try {
        const host = app.config.HOST;
        const port = app.config.PORT;
        await app.listen({ port, host });
        app.log.info(`Server running at http://${host}:${port}`);
    }
    catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}
start();
//# sourceMappingURL=index.js.map