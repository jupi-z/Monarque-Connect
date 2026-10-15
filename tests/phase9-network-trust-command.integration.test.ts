import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaOutboxWriter } from '../src/events/prisma-outbox.writer.js';
import { PlatformAuthorizationService } from '../src/entitlements/platform-authorization.service.js';
import { NetworkTrustCommandService } from '../src/network/network-trust-command.service.js';

describe('Phase 9 Network trust Control Plane command', () => {
  const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_phase9_task2_test';
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  let commands: NetworkTrustCommandService;
  let organizationId = '';
  let actorUserId = '';

  beforeAll(async () => {
    await prisma.$connect();
    actorUserId = randomUUID();
    organizationId = randomUUID();
    const businessTypeCode = `PHASE9_TRUST_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    await prisma.businessType.create({ data: { code: businessTypeCode, name: 'Phase 9 trust test', sortOrder: 0 } });
    await prisma.user.create({ data: { id: actorUserId, email: `${actorUserId}@example.test`, normalizedEmail: `${actorUserId}@example.test`, passwordHash: 'not-used', firstName: 'Platform', lastName: 'Admin' } });
    await prisma.organization.create({ data: { id: organizationId, businessTypeCode, name: 'Phase 9 Trust Org', handle: `phase9-trust-${organizationId.slice(0, 8)}`, defaultCurrency: 'EUR' } });
    commands = new NetworkTrustCommandService(
      prisma as never,
      new PrismaOutboxWriter(),
      new PlatformAuthorizationService(new ConfigService({ PLATFORM_ADMIN_USER_IDS: [actorUserId] })),
    );
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.delete({ where: { id: actorUserId } });
    await prisma.$disconnect();
  });

  it('sets trust atomically, replays idempotently and rejects divergent reuse', async () => {
    const principal = { userId: actorUserId, sessionId: randomUUID() };
    const input = { status: 'VERIFIED' as const, reason: 'Manual platform verification', method: 'CONTROL_PLANE', verificationExpiresAt: '2027-01-01T00:00:00.000Z' };
    const first = await commands.set(principal, organizationId, input, 'trust-command-1');
    const replay = await commands.set(principal, organizationId, input, 'trust-command-1');

    expect(replay).toEqual(first);
    await expect(commands.set(principal, organizationId, { ...input, reason: 'Different reason' }, 'trust-command-1')).rejects.toThrow('different command');
    await expect(prisma.networkTrustCommandReceipt.count({ where: { organizationId, actorUserId } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { organizationId, eventType: 'organization.verification_changed' } })).resolves.toBe(1);
    await expect(prisma.organizationNetworkTrust.findUnique({ where: { organizationId } })).resolves.toMatchObject({ verificationStatus: 'VERIFIED' });
  });
});
