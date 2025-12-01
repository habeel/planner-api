import { z } from 'zod';
import { AuthService } from '../services/authService.js';
const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().optional(),
});
const loginSchema = z.object({
    email: z.string().email(),
    password: z.string(),
});
const refreshSchema = z.object({
    refreshToken: z.string(),
});
export default async function authRoutes(fastify) {
    const authService = new AuthService(fastify);
    // POST /api/auth/register
    fastify.post('/register', async (request, reply) => {
        const parseResult = registerSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.status(400).send({
                error: 'Invalid input',
                code: 'INVALID_INPUT',
                details: parseResult.error.flatten(),
            });
        }
        const { email, password, name } = parseResult.data;
        try {
            const result = await authService.register(email, password, name);
            return reply.status(201).send(result);
        }
        catch (err) {
            if (err.message.includes('duplicate key')) {
                return reply.status(409).send({
                    error: 'Email already registered',
                    code: 'EMAIL_EXISTS',
                });
            }
            throw err;
        }
    });
    // POST /api/auth/login
    fastify.post('/login', async (request, reply) => {
        const parseResult = loginSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.status(400).send({
                error: 'Invalid input',
                code: 'INVALID_INPUT',
                details: parseResult.error.flatten(),
            });
        }
        const { email, password } = parseResult.data;
        const result = await authService.login(email, password);
        if (!result) {
            return reply.status(401).send({
                error: 'Invalid email or password',
                code: 'INVALID_CREDENTIALS',
            });
        }
        return reply.send(result);
    });
    // POST /api/auth/refresh
    fastify.post('/refresh', async (request, reply) => {
        const parseResult = refreshSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.status(400).send({
                error: 'Invalid input',
                code: 'INVALID_INPUT',
            });
        }
        const { refreshToken } = parseResult.data;
        const result = await authService.refresh(refreshToken);
        if (!result) {
            return reply.status(401).send({
                error: 'Invalid or expired refresh token',
                code: 'INVALID_REFRESH_TOKEN',
            });
        }
        return reply.send(result);
    });
    // POST /api/auth/logout
    fastify.post('/logout', async (request, reply) => {
        const parseResult = refreshSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.status(400).send({
                error: 'Invalid input',
                code: 'INVALID_INPUT',
            });
        }
        const { refreshToken } = parseResult.data;
        await authService.logout(refreshToken);
        return reply.send({ success: true });
    });
}
//# sourceMappingURL=auth.js.map