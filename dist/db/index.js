import pg from 'pg';
const { Pool } = pg;
export function createPool(config) {
    return new Pool({
        connectionString: config.DATABASE_URL,
    });
}
//# sourceMappingURL=index.js.map