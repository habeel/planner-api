import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from '../../app.js';
import { setupTestDatabase, teardownTestDatabase, cleanDatabase, getTestDb } from '../../test/helpers/simpleTestDb.js';
import { createTestSetup, createTestTask } from '../../test/helpers/fixtures.js';
import type { FastifyInstance } from 'fastify';

describe('Task Dependencies Integration Tests', () => {
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

  describe('POST /api/tasks/:id/dependencies', () => {
    it('should add a dependency between tasks', async () => {
      const db = getTestDb();
      const { user, workspace } = await createTestSetup(db);
      const task1 = await createTestTask(db, workspace.id, { title: 'Task 1' });
      const task2 = await createTestTask(db, workspace.id, { title: 'Task 2' });

      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password: 'Password123!',
        },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      // Task 2 depends on Task 1
      const response = await app.inject({
        method: 'POST',
        url: `/api/tasks/${task2.id}/dependencies`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          depends_on_task_id: task1.id,
          type: 'FS', // Finish-to-Start
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.dependency).toBeDefined();
      expect(body.dependency.task_id).toBe(task2.id);
      expect(body.dependency.depends_on_task_id).toBe(task1.id);
      expect(body.dependency.type).toBe('FS');
    });

    it('should prevent circular dependencies', async () => {
      const db = getTestDb();
      const { user, workspace } = await createTestSetup(db);
      const task1 = await createTestTask(db, workspace.id, { title: 'Task 1' });
      const task2 = await createTestTask(db, workspace.id, { title: 'Task 2' });

      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password: 'Password123!',
        },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      // Task 2 depends on Task 1
      await app.inject({
        method: 'POST',
        url: `/api/tasks/${task2.id}/dependencies`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          depends_on_task_id: task1.id,
        },
      });

      // Try to make Task 1 depend on Task 2 (circular!)
      const response = await app.inject({
        method: 'POST',
        url: `/api/tasks/${task1.id}/dependencies`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          depends_on_task_id: task2.id,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('CIRCULAR_DEPENDENCY');
    });

    it('should prevent circular dependencies in chain', async () => {
      const db = getTestDb();
      const { user, workspace } = await createTestSetup(db);
      const task1 = await createTestTask(db, workspace.id, { title: 'Task 1' });
      const task2 = await createTestTask(db, workspace.id, { title: 'Task 2' });
      const task3 = await createTestTask(db, workspace.id, { title: 'Task 3' });

      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password: 'Password123!',
        },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      // Task 2 depends on Task 1
      await app.inject({
        method: 'POST',
        url: `/api/tasks/${task2.id}/dependencies`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          depends_on_task_id: task1.id,
        },
      });

      // Task 3 depends on Task 2
      await app.inject({
        method: 'POST',
        url: `/api/tasks/${task3.id}/dependencies`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          depends_on_task_id: task2.id,
        },
      });

      // Try to make Task 1 depend on Task 3 (circular chain!)
      const response = await app.inject({
        method: 'POST',
        url: `/api/tasks/${task1.id}/dependencies`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          depends_on_task_id: task3.id,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('CIRCULAR_DEPENDENCY');
    });

    it('should reject dependency to task in different workspace', async () => {
      const db = getTestDb();
      const setup1 = await createTestSetup(db);
      const setup2 = await createTestSetup(db);

      const task1 = await createTestTask(db, setup1.workspace.id);
      const task2 = await createTestTask(db, setup2.workspace.id);

      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: setup1.user.email,
          password: 'Password123!',
        },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      const response = await app.inject({
        method: 'POST',
        url: `/api/tasks/${task1.id}/dependencies`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          depends_on_task_id: task2.id,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('INVALID_DEPENDENCY');
    });

    it('should reject duplicate dependency', async () => {
      const db = getTestDb();
      const { user, workspace } = await createTestSetup(db);
      const task1 = await createTestTask(db, workspace.id);
      const task2 = await createTestTask(db, workspace.id);

      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password: 'Password123!',
        },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      // Add dependency first time
      await app.inject({
        method: 'POST',
        url: `/api/tasks/${task2.id}/dependencies`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          depends_on_task_id: task1.id,
        },
      });

      // Try to add same dependency again
      const response = await app.inject({
        method: 'POST',
        url: `/api/tasks/${task2.id}/dependencies`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          depends_on_task_id: task1.id,
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('DEPENDENCY_EXISTS');
    });
  });

  describe('DELETE /api/tasks/:id/dependencies/:depId', () => {
    it('should remove a dependency', async () => {
      const db = getTestDb();
      const { user, workspace } = await createTestSetup(db);
      const task1 = await createTestTask(db, workspace.id);
      const task2 = await createTestTask(db, workspace.id);

      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password: 'Password123!',
        },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      // Add dependency
      const addResponse = await app.inject({
        method: 'POST',
        url: `/api/tasks/${task2.id}/dependencies`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          depends_on_task_id: task1.id,
        },
      });

      const { dependency } = JSON.parse(addResponse.body);

      // Remove dependency
      const removeResponse = await app.inject({
        method: 'DELETE',
        url: `/api/tasks/${task2.id}/dependencies/${dependency.id}`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(removeResponse.statusCode).toBe(200);

      // Verify dependency is removed
      const getResponse = await app.inject({
        method: 'GET',
        url: `/api/tasks/${task2.id}`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      const body = JSON.parse(getResponse.body);
      expect(body.dependencies).toHaveLength(0);
    });
  });

  describe('GET /api/tasks/:id (with dependencies)', () => {
    it('should return task with dependencies and dependents', async () => {
      const db = getTestDb();
      const { user, workspace } = await createTestSetup(db);
      const task1 = await createTestTask(db, workspace.id, { title: 'Task 1' });
      const task2 = await createTestTask(db, workspace.id, { title: 'Task 2' });
      const task3 = await createTestTask(db, workspace.id, { title: 'Task 3' });

      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: user.email,
          password: 'Password123!',
        },
      });
      const { accessToken } = JSON.parse(loginResponse.body);

      // Task 2 depends on Task 1
      await app.inject({
        method: 'POST',
        url: `/api/tasks/${task2.id}/dependencies`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          depends_on_task_id: task1.id,
        },
      });

      // Task 3 depends on Task 2
      await app.inject({
        method: 'POST',
        url: `/api/tasks/${task3.id}/dependencies`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          depends_on_task_id: task2.id,
        },
      });

      // Get Task 2 details
      const response = await app.inject({
        method: 'GET',
        url: `/api/tasks/${task2.id}`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.task.title).toBe('Task 2');
      expect(body.dependencies).toHaveLength(1); // Task 2 depends on Task 1
      expect(body.dependencies[0].depends_on_task_id).toBe(task1.id);
      expect(body.dependents).toHaveLength(1); // Task 3 depends on Task 2
      expect(body.dependents[0].task_id).toBe(task3.id);
    });
  });
});
