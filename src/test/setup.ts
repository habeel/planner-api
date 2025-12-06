import { config } from 'dotenv';
import { beforeAll, afterAll } from 'vitest';

// Load test environment variables
config({ path: '.env.test' });

// Global test setup
beforeAll(async () => {
  // Any global setup can go here
  console.log('🧪 Starting test suite...');
});

afterAll(async () => {
  // Any global cleanup can go here
  console.log('✅ Test suite completed');
});
