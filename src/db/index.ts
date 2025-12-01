import pg from 'pg';
import type { Env } from '../config/index.js';

const { Pool } = pg;

export function createPool(config: Env) {
  return new Pool({
    connectionString: config.DATABASE_URL,
  });
}

export type DbPool = pg.Pool;
export type DbClient = pg.PoolClient;
