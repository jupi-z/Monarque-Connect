import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.e2e.test.ts'],
    setupFiles: ['tests/setup/reset-test-database.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
    minWorkers: 1,
    maxWorkers: 1,
  },
});
