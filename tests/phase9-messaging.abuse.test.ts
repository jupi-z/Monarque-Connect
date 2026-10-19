import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { MessagingAbuseService } from '../src/messaging/abuse.service.js';

function bucket(dimension: 'ACTOR' | 'ORGANIZATION' | 'RELATION', attemptCount: number, fingerprintCount = 1, blockedUntil: Date | null = null) {
  return { id: randomUUID(), dimension, attempt_count: attemptCount, accepted_count: 0, rejected_count: 0, blocked_until: blockedUntil, window_ends: new Date(Date.now() + 60_000), fingerprint_count: fingerprintCount };
}

function transaction(rows: unknown[]) {
  const queryRaw = vi.fn();
  for (const row of rows) queryRaw.mockResolvedValueOnce([row]);
  return { tx: { $queryRaw: queryRaw, $executeRaw: vi.fn().mockResolvedValue(1) } as unknown as Prisma.TransactionClient, executeRaw: queryRaw };
}

describe('Phase 9 messaging anti-abuse reservation', () => {
  it('reserves actor, organization and relation buckets atomically for an accepted message', async () => {
    const fake = transaction([bucket('ACTOR', 1), { fingerprint_count: 1 }, bucket('ORGANIZATION', 1), { fingerprint_count: 1 }, bucket('RELATION', 1), { fingerprint_count: 1 }]);
    const service = new MessagingAbuseService();
    const result = await service.reserve(fake.tx, { actorUserId: randomUUID(), organizationId: randomUUID(), targetOrganizationId: randomUUID(), conversationId: randomUUID(), body: 'hello' }, new Date('2026-10-16T12:00:00.000Z'));
    expect(result.allowed).toBe(true);
    expect(result.dimensions).toEqual(expect.arrayContaining([{ dimension: 'ACTOR', attempts: 1, rejected: 0 }, { dimension: 'ORGANIZATION', attempts: 1, rejected: 0 }, { dimension: 'RELATION', attempts: 1, rejected: 0 }]));
    expect((fake.tx.$executeRaw as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3);
  });

  it('rejects an exceeded bucket and still updates every rejection counter', async () => {
    const fake = transaction([bucket('ACTOR', 21), { fingerprint_count: 1 }, bucket('ORGANIZATION', 1), { fingerprint_count: 1 }, bucket('RELATION', 1), { fingerprint_count: 1 }]);
    const service = new MessagingAbuseService();
    const result = await service.reserve(fake.tx, { actorUserId: randomUUID(), organizationId: randomUUID(), targetOrganizationId: randomUUID(), conversationId: randomUUID(), body: 'spam' }, new Date('2026-10-16T12:00:00.000Z'));
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect((fake.tx.$executeRaw as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3);
    expect(result.dimensions.find((dimension) => dimension.dimension === 'ACTOR')?.rejected).toBe(1);
  });

  it('rejects repeated content after the configured fingerprint threshold', async () => {
    const fake = transaction([bucket('ACTOR', 4), { fingerprint_count: 4 }, bucket('ORGANIZATION', 4), { fingerprint_count: 4 }, bucket('RELATION', 4), { fingerprint_count: 4 }]);
    const service = new MessagingAbuseService();
    const result = await service.reserve(fake.tx, { actorUserId: randomUUID(), organizationId: randomUUID(), targetOrganizationId: randomUUID(), conversationId: randomUUID(), body: 'repeat' }, new Date('2026-10-16T12:00:00.000Z'));
    expect(result.allowed).toBe(false);
    expect(result.dimensions.every((dimension) => dimension.rejected === 1)).toBe(true);
  });

  it('keeps independent fingerprint counters when content alternates within one bucket', async () => {
    const bodies = ['A', 'A', 'A', 'B', 'A', 'A', 'A'];
    const fingerprintCounts = new Map<string, number>();
    let call = 0;
    const queryRaw = vi.fn(() => {
      const requestIndex = Math.floor(call / 6);
      const withinRequest = call % 6;
      call += 1;
      if (withinRequest % 2 === 0) return Promise.resolve([bucket(withinRequest === 0 ? 'ACTOR' : withinRequest === 2 ? 'ORGANIZATION' : 'RELATION', requestIndex + 1)]);
      const dimension = withinRequest === 1 ? 'ACTOR' : withinRequest === 3 ? 'ORGANIZATION' : 'RELATION';
      const fingerprint = `${dimension}:${bodies[requestIndex]!}`;
      const count = (fingerprintCounts.get(fingerprint) ?? 0) + 1;
      fingerprintCounts.set(fingerprint, count);
      return Promise.resolve([{ fingerprint_count: count }]);
    });
    const tx = { $queryRaw: queryRaw, $executeRaw: vi.fn().mockResolvedValue(1) } as unknown as Prisma.TransactionClient;
    const service = new MessagingAbuseService();
    const results = [];
    for (const body of bodies) results.push(await service.reserve(tx, { actorUserId: randomUUID(), organizationId: randomUUID(), targetOrganizationId: randomUUID(), conversationId: randomUUID(), body }, new Date('2026-10-16T12:00:00.000Z')));
    expect(results.slice(0, 4).every((result) => result.allowed)).toBe(true);
    expect(results[4]!.allowed).toBe(false);
  });
});
