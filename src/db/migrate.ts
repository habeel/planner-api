import pg from 'pg';
import { config } from 'dotenv';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

config();

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

async function runMigrations() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('Running migrations...');

    // First, ensure migrations table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );
    `);

    // Read migration files
    const migrationsDir = join(__dirname, 'migrations');
    const migrationFiles = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      const migrationName = file.replace('.sql', '');

      // Check if migration has already been executed
      const result = await pool.query(
        'SELECT id FROM migrations WHERE name = $1',
        [migrationName]
      );

      if (result.rows.length === 0) {
        console.log(`Running migration: ${migrationName}`);
        const sql = readFileSync(join(migrationsDir, file), 'utf-8');
        await pool.query(sql);
        await pool.query('INSERT INTO migrations (name) VALUES ($1)', [migrationName]);
        console.log(`Completed migration: ${migrationName}`);
      } else {
        console.log(`Skipping migration: ${migrationName} (already executed)`);
      }
    }

    console.log('All migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
