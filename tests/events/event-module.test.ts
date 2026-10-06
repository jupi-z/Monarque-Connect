import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { EventModule } from '../../src/events/event.module.js';
import { EventWorker } from '../../src/events/event-worker.js';
import { OutboxRepository } from '../../src/events/outbox.repository.js';
import { PrismaFoundationProbeService } from '../../src/events/prisma-foundation-probe.service.js';

describe('EventModule', () => {
  it('registers the durable event infrastructure without an HTTP business controller', () => {
    const providers = Reflect.getMetadata('providers', EventModule) as unknown[];
    const controllers = Reflect.getMetadata('controllers', EventModule) as unknown[] | undefined;

    expect(providers).toContain(OutboxRepository);
    expect(providers).toContain(PrismaFoundationProbeService);
    expect(providers.some((provider) =>
      provider === EventWorker ||
      (typeof provider === 'object' && provider !== null && 'provide' in provider && provider.provide === EventWorker),
    )).toBe(true);
    expect(controllers ?? []).toHaveLength(0);
  });
});
