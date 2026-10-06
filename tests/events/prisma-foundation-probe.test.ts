import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { createRequestContext } from '../../src/events/event-context.js';
import { PrismaFoundationProbeService } from '../../src/events/prisma-foundation-probe.service.js';
import { PrismaOutboxWriter } from '../../src/events/prisma-outbox.writer.js';

describe('PrismaFoundationProbeService', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const service = new PrismaFoundationProbeService(new PrismaOutboxWriter());

  beforeAll(async () => prisma.$connect());
  beforeEach(async () => {
    await prisma.eventConsumerReceipt.deleteMany();
    await prisma.foundationProbeProjection.deleteMany();
    await prisma.outboxEvent.deleteMany();
    await prisma.foundationProbe.deleteMany();
  });
  afterAll(async () => prisma.$disconnect());

  it('writes the foundation fact and outbox event through one Prisma transaction client', async () => {
    const tx = {
      foundationProbe: { create: vi.fn().mockResolvedValue({}) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const result = await service.recordFoundationProbe(tx, 'prisma-proof', createRequestContext());

    expect(result.probeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(tx.foundationProbe.create).toHaveBeenCalledWith({
      data: { id: result.probeId, value: 'prisma-proof' },
    });
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        id: result.eventId,
        eventType: 'foundation.probe.recorded',
        payloadJson: { value: 'prisma-proof' },
      }),
    }));
  });

  it('commits the fact and outbox row atomically through a real Prisma transaction', async () => {
    const result = await prisma.$transaction((tx) =>
      service.recordFoundationProbe(tx, 'prisma-integration', createRequestContext()),
    );

    await expect(prisma.foundationProbe.findUnique({ where: { id: result.probeId } })).resolves.toMatchObject({
      value: 'prisma-integration',
    });
    await expect(prisma.outboxEvent.findUnique({ where: { id: result.eventId } })).resolves.toMatchObject({
      eventType: 'foundation.probe.recorded',
      payloadJson: { value: 'prisma-integration' },
    });
  });

  it('rolls back both Prisma writes when the transaction fails', async () => {
    await expect(prisma.$transaction(async (tx) => {
      await service.recordFoundationProbe(tx, 'prisma-rollback', createRequestContext());
      throw new Error('force rollback');
    })).rejects.toThrow('force rollback');

    await expect(prisma.foundationProbe.count()).resolves.toBe(0);
    await expect(prisma.outboxEvent.count()).resolves.toBe(0);
  });
});
