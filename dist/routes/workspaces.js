import { z } from 'zod';
import { WorkspaceService } from '../services/workspaceService.js';
import { UserService } from '../services/userService.js';
const createWorkspaceSchema = z.object({
    name: z.string().min(1).max(255),
});
const addMemberSchema = z.object({
    email: z.string().email(),
    role: z.enum(['ADMIN', 'TEAM_LEAD', 'DEVELOPER', 'READ_ONLY']),
});
const updateMemberRoleSchema = z.object({
    role: z.enum(['ADMIN', 'TEAM_LEAD', 'DEVELOPER', 'READ_ONLY']),
});
export default async function workspaceRoutes(fastify) {
    const workspaceService = new WorkspaceService(fastify);
    const userService = new UserService(fastify);
    // GET /api/workspaces
    fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const workspaces = await workspaceService.getUserWorkspaces(request.user.id);
        return reply.send({ workspaces });
    });
    // POST /api/workspaces
    fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const parseResult = createWorkspaceSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.status(400).send({
                error: 'Invalid input',
                code: 'INVALID_INPUT',
                details: parseResult.error.flatten(),
            });
        }
        const workspace = await workspaceService.create(parseResult.data.name, request.user.id);
        return reply.status(201).send({ workspace });
    });
    // GET /api/workspaces/:id
    fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { id } = request.params;
        // Check user has access
        const role = await workspaceService.getUserRole(id, request.user.id);
        if (!role) {
            return reply.status(403).send({
                error: 'Access denied',
                code: 'FORBIDDEN',
            });
        }
        const workspace = await workspaceService.getById(id);
        if (!workspace) {
            return reply.status(404).send({
                error: 'Workspace not found',
                code: 'NOT_FOUND',
            });
        }
        const members = await workspaceService.getMembers(id);
        return reply.send({ workspace, members, userRole: role });
    });
    // POST /api/workspaces/:id/members
    fastify.post('/:id/members', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { id } = request.params;
        // Check user is admin
        const userRole = await workspaceService.getUserRole(id, request.user.id);
        if (userRole !== 'ADMIN') {
            return reply.status(403).send({
                error: 'Only admins can add members',
                code: 'FORBIDDEN',
            });
        }
        const parseResult = addMemberSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.status(400).send({
                error: 'Invalid input',
                code: 'INVALID_INPUT',
                details: parseResult.error.flatten(),
            });
        }
        const { email, role } = parseResult.data;
        // Find user by email
        const targetUser = await userService.getByEmail(email);
        if (!targetUser) {
            return reply.status(404).send({
                error: 'User not found',
                code: 'USER_NOT_FOUND',
            });
        }
        const membership = await workspaceService.addMember(id, targetUser.id, role);
        return reply.status(201).send({ membership });
    });
    // PATCH /api/workspaces/:id/members/:userId
    fastify.patch('/:id/members/:userId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { id, userId } = request.params;
        // Check user is admin
        const userRole = await workspaceService.getUserRole(id, request.user.id);
        if (userRole !== 'ADMIN') {
            return reply.status(403).send({
                error: 'Only admins can update member roles',
                code: 'FORBIDDEN',
            });
        }
        const parseResult = updateMemberRoleSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.status(400).send({
                error: 'Invalid input',
                code: 'INVALID_INPUT',
                details: parseResult.error.flatten(),
            });
        }
        const membership = await workspaceService.updateMemberRole(id, userId, parseResult.data.role);
        if (!membership) {
            return reply.status(404).send({
                error: 'Member not found',
                code: 'NOT_FOUND',
            });
        }
        return reply.send({ membership });
    });
    // DELETE /api/workspaces/:id/members/:userId
    fastify.delete('/:id/members/:userId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { id, userId } = request.params;
        // Check user is admin
        const userRole = await workspaceService.getUserRole(id, request.user.id);
        if (userRole !== 'ADMIN') {
            return reply.status(403).send({
                error: 'Only admins can remove members',
                code: 'FORBIDDEN',
            });
        }
        // Prevent removing self if only admin
        if (userId === request.user.id) {
            const members = await workspaceService.getMembers(id);
            const adminCount = members.filter(m => m.role === 'ADMIN').length;
            if (adminCount <= 1) {
                return reply.status(400).send({
                    error: 'Cannot remove the only admin',
                    code: 'CANNOT_REMOVE_LAST_ADMIN',
                });
            }
        }
        const removed = await workspaceService.removeMember(id, userId);
        if (!removed) {
            return reply.status(404).send({
                error: 'Member not found',
                code: 'NOT_FOUND',
            });
        }
        return reply.send({ success: true });
    });
}
//# sourceMappingURL=workspaces.js.map