import { describe, expect, it, vi } from 'vitest';
import { createRequestContext } from '../../src/events/event-context.js';
import { PrismaFoundationProbeService } from '../../src/events/prisma-foundation-probe.service.js';
import { PrismaOutboxWriter } from '../../src/events/prisma-outbox.writer.js';

describe('PrismaFoundationProbeService', () => {
  it('writes the foundation fact and outbox event through one Prisma transaction client', async () => {
    const tx = {
      foundationProbe: { create: vi.fn().mockResolvedValue({}) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new PrismaFoundationProbeService(new PrismaOutboxWriter());

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
});
