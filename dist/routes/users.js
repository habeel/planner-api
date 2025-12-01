import { z } from 'zod';
import { UserService } from '../services/userService.js';
const updateUserSchema = z.object({
    name: z.string().optional(),
    capacity_week_hours: z.number().min(0).max(168).optional(),
    timezone: z.string().optional(),
});
export default async function userRoutes(fastify) {
    const userService = new UserService(fastify);
    // GET /api/users/me
    fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const user = await userService.getUserWithRoles(request.user.id);
        if (!user) {
            return reply.status(404).send({
                error: 'User not found',
                code: 'NOT_FOUND',
            });
        }
        return reply.send({ user });
    });
    // PATCH /api/users/me
    fastify.patch('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const parseResult = updateUserSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.status(400).send({
                error: 'Invalid input',
                code: 'INVALID_INPUT',
                details: parseResult.error.flatten(),
            });
        }
        const updatedUser = await userService.updateUser(request.user.id, parseResult.data);
        if (!updatedUser) {
            return reply.status(404).send({
                error: 'User not found',
                code: 'NOT_FOUND',
            });
        }
        return reply.send({ user: updatedUser });
    });
}
//# sourceMappingURL=users.js.map