import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from '../../app.js';
import { setupTestDatabase, teardownTestDatabase, cleanDatabase, getTestDb } from '../../test/helpers/simpleTestDb.js';
import { createTestUser } from '../../test/helpers/fixtures.js';
import type { FastifyInstance } from 'fastify';

describe('Auth Integration Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await setupTestDatabase();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanDatabase(getTestDb());
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'newuser@example.com',
          password: 'Password123!',
          name: 'New User',
          organization_name: 'Test Organization',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.user).toBeDefined();
      expect(body.user.email).toBe('newuser@example.com');
      expect(body.user.name).toBe('New User');
      expect(body.accessToken).toBeDefined();
      expect(body.refreshToken).toBeDefined();
      expect(body.organization).toBeDefined();
      expect(body.organization.name).toBe('Test Organization');
      expect(body.user.password_hash).toBeUndefined(); // Should not expose password hash
    });

    it('should reject registration with duplicate email', async () => {
      const db = getTestDb();
      await createTestUser(db, { email: 'existing@example.com' });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'existing@example.com',
          password: 'Password123!',
          name: 'Duplicate User',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('EMAIL_EXISTS');
    });

    it('should reject registration with invalid email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'not-an-email',
          password: 'Password123!',
          name: 'Invalid User',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('INVALID_INPUT');
    });

    it('should reject registration with short password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'short',
          name: 'Test User',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('INVALID_INPUT');
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login with correct credentials', async () => {
      const db = getTestDb();
      await createTestUser(db, {
        email: 'test@example.com',
        password: 'Password123!',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'Password123!',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.user).toBeDefined();
      expect(body.user.email).toBe('test@example.com');
      expect(body.accessToken).toBeDefined();
      expect(body.refreshToken).toBeDefined();
      expect(body.user.password_hash).toBeUndefined();
    });

    it('should reject login with incorrect password', async () => {
      const db = getTestDb();
      await createTestUser(db, {
        email: 'test@example.com',
        password: 'Password123!',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'WrongPassword!',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('INVALID_CREDENTIALS');
    });

    it('should reject login with non-existent email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'nonexistent@example.com',
          password: 'Password123!',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should refresh access token with valid refresh token', async () => {
      const db = getTestDb();
      const user = await createTestUser(db, {
        email: 'test@example.com',
        password: 'Password123!',
      });

      // Login to get tokens
      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'Password123!',
        },
      });

      const loginBody = JSON.parse(loginResponse.body);
      const refreshToken = loginBody.refreshToken;

      // Use refresh token
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: {
          refreshToken,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.accessToken).toBeDefined();
      expect(body.accessToken).not.toBe(loginBody.accessToken); // Should be a new token
    });

    it('should reject refresh with invalid token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: {
          refreshToken: 'invalid-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('INVALID_REFRESH_TOKEN');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should logout and invalidate refresh token', async () => {
      const db = getTestDb();
      await createTestUser(db, {
        email: 'test@example.com',
        password: 'Password123!',
      });

      // Login
      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'Password123!',
        },
      });

      const loginBody = JSON.parse(loginResponse.body);
      const refreshToken = loginBody.refreshToken;

      // Logout
      const logoutResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        payload: {
          refreshToken,
        },
      });

      expect(logoutResponse.statusCode).toBe(200);

      // Try to use the refresh token again (should fail)
      const refreshResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: {
          refreshToken,
        },
      });

      expect(refreshResponse.statusCode).toBe(401);
    });
  });
});
