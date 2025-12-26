import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
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

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

export default async function authRoutes(fastify: FastifyInstance) {
  const authService = new AuthService(fastify);
  const orgService = new OrganizationService(fastify);

  // POST /api/auth/register
  fastify.post('/register', async (request: FastifyRequest, reply: FastifyReply) => {
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
    } catch (err) {
      if ((err as Error).message.includes('duplicate key')) {
        if ((err as Error).message.includes('organizations_slug_key')) {
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
  fastify.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
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
  fastify.post('/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
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
  fastify.post('/logout', async (request: FastifyRequest, reply: FastifyReply) => {
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

  // POST /api/auth/forgot-password
  fastify.post('/forgot-password', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = forgotPasswordSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid input',
        code: 'INVALID_INPUT',
        details: parseResult.error.flatten(),
      });
    }

    const { email } = parseResult.data;
    await authService.requestPasswordReset(email);

    // Always return success to prevent email enumeration
    return reply.send({
      success: true,
      message: 'If an account exists with that email, a password reset link has been sent.',
    });
  });

  // POST /api/auth/reset-password
  fastify.post('/reset-password', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = resetPasswordSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid input',
        code: 'INVALID_INPUT',
        details: parseResult.error.flatten(),
      });
    }

    const { token, password } = parseResult.data;
    const result = await authService.resetPassword(token, password);

    if (!result.success) {
      return reply.status(400).send({
        error: result.error,
        code: 'RESET_FAILED',
      });
    }

    return reply.send({
      success: true,
      message: 'Password has been reset successfully. Please log in with your new password.',
    });
  });

  // POST /api/auth/change-password (requires authentication)
  fastify.post('/change-password', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = changePasswordSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid input',
        code: 'INVALID_INPUT',
        details: parseResult.error.flatten(),
      });
    }

    const { currentPassword, newPassword } = parseResult.data;
    const result = await authService.changePassword(request.user.id, currentPassword, newPassword);

    if (!result.success) {
      return reply.status(400).send({
        error: result.error,
        code: 'CHANGE_PASSWORD_FAILED',
      });
    }

    return reply.send({
      success: true,
      message: 'Password changed successfully.',
    });
  });

  // POST /api/auth/send-verification (requires authentication)
  fastify.post('/send-verification', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await authService.sendVerificationEmail(request.user.id);

    return reply.send({
      success: result.success,
      message: result.success
        ? 'Verification email sent. Please check your inbox.'
        : 'Failed to send verification email.',
    });
  });

  // POST /api/auth/verify-email
  fastify.post('/verify-email', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = verifyEmailSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid input',
        code: 'INVALID_INPUT',
        details: parseResult.error.flatten(),
      });
    }

    const { token } = parseResult.data;
    const result = await authService.verifyEmail(token);

    if (!result.success) {
      return reply.status(400).send({
        error: result.error,
        code: 'VERIFICATION_FAILED',
      });
    }

    return reply.send({
      success: true,
      message: 'Email verified successfully.',
    });
  });
}
