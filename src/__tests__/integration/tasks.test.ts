import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from '../../app.js';
import { setupTestDatabase, teardownTestDatabase, cleanDatabase, getTestDb } from '../../test/helpers/simpleTestDb.js';
import { createTestSetup, createTestTask, addUserToWorkspace } from '../../test/helpers/fixtures.js';
import type { FastifyInstance } from 'fastify';

describe('Tasks Integration Tests', () => {
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

  describe('POST /api/tasks', () => {
    it('should create a new task', async () => {
      const db = getTestDb();
      const { user, workspace } = await createTestSetup(db);

      // Get access token
      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password: 'Password123!',
        },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      const response = await app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          workspace_id: workspace.id,
          title: 'Test Task',
          description: 'Test description',
          estimated_hours: 8,
          status: 'BACKLOG',
          priority: 'MED',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.task).toBeDefined();
      expect(body.task.title).toBe('Test Task');
      expect(body.task.estimated_hours).toBe(8);
      expect(body.task.workspace_id).toBe(workspace.id);
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: {
          workspace_id: 'some-id',
          title: 'Test Task',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject task creation for workspace without access', async () => {
      const db = getTestDb();
      const setup1 = await createTestSetup(db);
      const setup2 = await createTestSetup(db);

      // Get token for user 1
      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: setup1.user.email,
          password: 'Password123!',
        },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      // Try to create task in user 2's workspace
      const response = await app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          workspace_id: setup2.workspace.id,
          title: 'Unauthorized Task',
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /api/tasks', () => {
    it('should list tasks in workspace', async () => {
      const db = getTestDb();
      const { user, workspace } = await createTestSetup(db);

      // Create some tasks
      await createTestTask(db, workspace.id, { title: 'Task 1' });
      await createTestTask(db, workspace.id, { title: 'Task 2' });
      await createTestTask(db, workspace.id, { title: 'Task 3' });

      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password: 'Password123!',
        },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      const response = await app.inject({
        method: 'GET',
        url: `/api/tasks?workspaceId=${workspace.id}`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.tasks).toHaveLength(3);
    });

    it('should filter tasks by assignee', async () => {
      const db = getTestDb();
      const { user, workspace } = await createTestSetup(db);

      // Create tasks with different assignees
      await createTestTask(db, workspace.id, {
        title: 'Task for user',
        assigned_to_user_id: user.id,
      });
      await createTestTask(db, workspace.id, {
        title: 'Unassigned task',
        assigned_to_user_id: null,
      });

      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password: 'Password123!',
        },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      const response = await app.inject({
        method: 'GET',
        url: `/api/tasks?workspaceId=${workspace.id}&assigneeId=${user.id}`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.tasks).toHaveLength(1);
      expect(body.tasks[0].title).toBe('Task for user');
    });
  });

  describe('PATCH /api/tasks/:id', () => {
    it('should update task fields', async () => {
      const db = getTestDb();
      const { user, workspace } = await createTestSetup(db);
      const task = await createTestTask(db, workspace.id, { title: 'Original Title' });

      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password: 'Password123!',
        },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/tasks/${task.id}`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          title: 'Updated Title',
          estimated_hours: 16,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.task.title).toBe('Updated Title');
      expect(body.task.estimated_hours).toBe(16);
    });

    it('should prevent READ_ONLY user from updating tasks', async () => {
      const db = getTestDb();
      const { user, workspace } = await createTestSetup(db);
      const task = await createTestTask(db, workspace.id);

      // Add read-only user
      const readOnlySetup = await createTestSetup(db);
      await addUserToWorkspace(db, workspace.id, readOnlySetup.user.id, 'READ_ONLY');

      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: readOnlySetup.user.email,
          password: 'Password123!',
        },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/tasks/${task.id}`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          title: 'Should not work',
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should require estimated_hours > 0 when status is PLANNED', async () => {
      const db = getTestDb();
      const { user, workspace } = await createTestSetup(db);
      const task = await createTestTask(db, workspace.id, {
        estimated_hours: 0,
        status: 'BACKLOG',
      });

      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password: 'Password123!',
        },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/tasks/${task.id}`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          status: 'PLANNED',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('ESTIMATED_HOURS_REQUIRED');
    });
  });

  describe('DELETE /api/tasks/:id', () => {
    it('should delete a task', async () => {
      const db = getTestDb();
      const { user, workspace } = await createTestSetup(db);
      const task = await createTestTask(db, workspace.id);

      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password: 'Password123!',
        },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/tasks/${task.id}`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);

      // Verify task is deleted
      const getResponse = await app.inject({
        method: 'GET',
        url: `/api/tasks?workspaceId=${workspace.id}`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      const body = JSON.parse(getResponse.body);
      expect(body.tasks).toHaveLength(0);
    });
  });
});
