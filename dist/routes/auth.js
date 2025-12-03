import { z } from 'zod';
import { AuthService } from '../services/authService.js';
import { OrganizationService } from '../services/organizationService.js';
const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().optional(),
    organization_name: z.string().min(1).max(255).optional(),
    organization_slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens').optional(),
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
    const orgService = new OrganizationService(fastify);
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
        const { email, password, name, organization_name, organization_slug } = parseResult.data;
        // Check if slug is available if provided
        if (organization_slug) {
            const slugAvailable = await orgService.isSlugAvailable(organization_slug);
            if (!slugAvailable) {
                return reply.status(409).send({
                    error: 'Organization slug is already taken',
                    code: 'SLUG_TAKEN',
                });
            }
        }
        try {
            const result = await authService.register({
                email,
                password,
                name,
                organization_name,
                organization_slug,
            });
            return reply.status(201).send(result);
        }
        catch (err) {
            if (err.message.includes('duplicate key')) {
                if (err.message.includes('organizations_slug_key')) {
                    return reply.status(409).send({
                        error: 'Organization slug is already taken',
                        code: 'SLUG_TAKEN',
                    });
                }
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