import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseHealthService } from '../src/database-health.service.js';
import { HealthController } from '../src/health.controller.js';

function createController(ping: () => Promise<void>): HealthController {
  const database = { ping } as unknown as DatabaseHealthService;
  return new HealthController(database);
}

describe('HealthController', () => {
  it('reports live', () => {
    expect(createController(vi.fn()).live()).toEqual({ status: 'ok' });
  });

  it('reports ready when PostgreSQL is reachable', async () => {
    const ping = vi.fn().mockResolvedValue(undefined);
    await expect(createController(ping).ready()).resolves.toEqual({ status: 'ok' });
    expect(ping).toHaveBeenCalledOnce();
  });

  it('reports unavailable when PostgreSQL is unreachable', async () => {
    const ping = vi.fn().mockRejectedValue(new Error('database unavailable'));
    await expect(createController(ping).ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
