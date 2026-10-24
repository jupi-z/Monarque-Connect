import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: [
      'tests/**/*.integration.test.ts',
      'tests/e2e/**',
      'tests/events/outbox-repository.test.ts',
      'tests/events/prisma-foundation-probe.test.ts',
      'tests/phase9-messaging.persistence.test.ts',
    ],
    hookTimeout: 60000,
    fileParallelism: false,
    minWorkers: 1,
    maxWorkers: 1,
  },
});
