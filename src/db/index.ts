import pg from 'pg';
import type { Env } from '../config/index.js';

const { Pool } = pg;

export function createPool(config: Env) {
  const isProduction = config.NODE_ENV === 'production';

  return new Pool({
    connectionString: config.DATABASE_URL,
    // Production pool settings
    max: isProduction ? 20 : 10, // Max connections
    idleTimeoutMillis: 30000, // Close idle connections after 30s
    connectionTimeoutMillis: 5000, // Timeout after 5s if can't connect
  });
}

export type DbPool = pg.Pool;
export type DbClient = pg.PoolClient;
