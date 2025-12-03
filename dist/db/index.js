import pg from 'pg';
const { Pool } = pg;
export function createPool(config) {
    const isProduction = config.NODE_ENV === 'production';
    return new Pool({
        connectionString: config.DATABASE_URL,
        // Production pool settings
        max: isProduction ? 20 : 10, // Max connections
        idleTimeoutMillis: 30000, // Close idle connections after 30s
        connectionTimeoutMillis: 5000, // Timeout after 5s if can't connect
    });
}
//# sourceMappingURL=index.js.map