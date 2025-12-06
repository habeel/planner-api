import { Pool } from 'pg';

let pool: Pool | null = null;

/**
 * Setup test database using existing PostgreSQL instance
 * (Alternative to Testcontainers when Docker is not available)
 */
export async function setupTestDatabase(): Promise<Pool> {
  if (pool) return pool;

  // Use the DATABASE_URL from .env.test
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL not set in environment');
  }

  console.log('🔗 Connecting to test database...');
  pool = new Pool({ connectionString });

  // Test connection
  try {
    await pool.query('SELECT 1');
    console.log('✅ Test database connected');
  } catch (error) {
    console.error('❌ Failed to connect to test database:', error);
    throw error;
  }

  return pool;
}

/**
 * Clean up test database connection
 */
export async function teardownTestDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('🛑 Test database disconnected');
  }
}

/**
 * Clean all tables for a fresh test state
 */
export async function cleanDatabase(db: Pool): Promise<void> {
  await db.query(`
    TRUNCATE TABLE
      audit_logs,
      refresh_tokens,
      time_entries,
      task_external_links,
      task_dependencies,
      tasks,
      integrations,
      time_off,
      invitations,
      user_workspace_roles,
      workspaces,
      user_organization_roles,
      organizations,
      users,
      platform_admins
    RESTART IDENTITY CASCADE
  `);
}

/**
 * Get the test database pool
 */
export function getTestDb(): Pool {
  if (!pool) {
    throw new Error('Test database not initialized. Call setupTestDatabase first.');
  }
  return pool;
}
