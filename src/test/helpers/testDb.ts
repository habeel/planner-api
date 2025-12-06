import { Pool } from 'pg';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let container: StartedPostgreSqlContainer | null = null;
let pool: Pool | null = null;

/**
 * Start a PostgreSQL container for testing and run migrations
 */
export async function setupTestDatabase(): Promise<Pool> {
  if (pool) return pool;

  console.log('🐳 Starting PostgreSQL test container...');
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('planner_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  const connectionString = container.getConnectionUri();
  pool = new Pool({ connectionString });

  // Run migrations
  await runMigrations(pool);

  console.log('✅ Test database ready');
  return pool;
}

/**
 * Clean up test database and stop container
 */
export async function teardownTestDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }

  if (container) {
    await container.stop();
    container = null;
    console.log('🛑 Test database stopped');
  }
}

/**
 * Run all database migrations
 */
async function runMigrations(db: Pool): Promise<void> {
  const migrationsDir = join(__dirname, '../../db/migrations');

  // Create migrations table
  await db.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    )
  `);

  // List of migrations in order
  const migrations = [
    '001_initial_schema.sql',
    '002_external_links.sql',
    '003_task_backlog_position.sql',
    '004_time_entries.sql',
    '005_organizations.sql',
    '006_fix_time_off.sql',
    '007_production_indexes.sql',
    '008_platform_admins.sql',
  ];

  for (const migration of migrations) {
    const migrationPath = join(migrationsDir, migration);

    try {
      const sql = await readFile(migrationPath, 'utf-8');
      await db.query(sql);
      await db.query(
        'INSERT INTO migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
        [migration]
      );
      console.log(`  ✓ Ran migration: ${migration}`);
    } catch (error) {
      console.error(`  ✗ Failed to run migration ${migration}:`, error);
      throw error;
    }
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
