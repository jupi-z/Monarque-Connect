import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from '../src/health.controller.js';
import type { PrismaService } from '../src/infrastructure/database/prisma.service.js';

function createPrisma(query: () => Promise<unknown>): PrismaService {
  return {
    $queryRaw: vi.fn(query),
  } as unknown as PrismaService;
}

describe('HealthController', () => {
  it('reports live', () => {
    const controller = new HealthController(createPrisma(() => Promise.resolve([1])));
    expect(controller.live()).toEqual({ status: 'ok' });
  });

  it('reports ready when PostgreSQL responds', async () => {
    const controller = new HealthController(createPrisma(() => Promise.resolve([1])));

    await expect(controller.ready()).resolves.toEqual({
      status: 'ok',
      dependencies: { database: 'ok' },
    });
  });

  it('reports unavailable when PostgreSQL does not respond', async () => {
    const controller = new HealthController(
      createPrisma(() => Promise.reject(new Error('database unavailable'))),
    );

    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
