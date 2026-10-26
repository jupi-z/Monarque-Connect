import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['tests/setup/lock-test-database.ts'],
    include: [
      'tests/**/*.integration.test.ts',
      'tests/events/outbox-repository.test.ts',
      'tests/events/prisma-foundation-probe.test.ts',
      'tests/phase9-messaging.persistence.test.ts',
    ],
    setupFiles: ['tests/setup/reset-test-database.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
    minWorkers: 1,
    maxWorkers: 1,
  },
});
