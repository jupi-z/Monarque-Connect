import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedReferenceData } from '../../prisma/seed.js';
import { PrismaOutboxWriter } from '../../src/events/prisma-outbox.writer.js';
import { BillingAdminService } from '../../src/billing/billing-admin.service.js';

describe('FairScale Billing admin price publication', () => {
  const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const admin = new BillingAdminService(prisma as never, new PrismaOutboxWriter());
  let actorUserId = '';
  let publishedPriceId = '';

  beforeAll(async () => {
    await prisma.$connect();
    await seedReferenceData(prisma);
    actorUserId = randomUUID();
    await prisma.user.create({ data: { id: actorUserId, email: `${actorUserId}@example.test`, normalizedEmail: `${actorUserId}@example.test`, passwordHash: 'not-used', firstName: 'Billing', lastName: 'Admin' } });
  });

  afterAll(async () => {
    if (publishedPriceId) await prisma.priceVersion.delete({ where: { id: publishedPriceId } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: publishedPriceId } });
    await prisma.auditEvent.deleteMany({ where: { actorUserId } });
    await prisma.user.delete({ where: { id: actorUserId } });
    await prisma.$disconnect();
  });

  it('publishes a new immutable version, retires the predecessor and replays idempotently', async () => {
    const principal = { userId: actorUserId, sessionId: randomUUID() };
    const input = { planCode: 'BUSINESS' as const, billingPeriod: 'MONTHLY' as const, currency: 'USD', baseAmountMinor: 4600, welcomeAmountMinor: 3910, annualDiscountAmountMinor: 0, includedEstablishments: 3, addonAmountMinor: 1100, addonCapacityUnits: 1 };
    const first = await admin.publishPrice(principal, input, 'admin-price-1') as { id: string; version: number; baseAmountMinor: number; addons: Array<{ amountMinor: number }> };
    publishedPriceId = first.id;
    expect(first).toMatchObject({ version: 2, baseAmountMinor: 4600, addons: [{ amountMinor: 1100 }] });
    const predecessor = await prisma.priceVersion.findUniqueOrThrow({ where: { planCode_version_billingPeriod: { planCode: 'BUSINESS', version: 1, billingPeriod: 'MONTHLY' } } });
    expect(predecessor.retiredAt).toBeInstanceOf(Date);
    await expect(admin.publishPrice(principal, input, 'admin-price-1')).resolves.toEqual(first);
    await expect(admin.publishPrice(principal, { ...input, baseAmountMinor: 4700 }, 'admin-price-1')).rejects.toThrow('another price publication');
    await expect(prisma.auditEvent.count({ where: { actorUserId, action: 'BILLING_PRICE_VERSION_PUBLISHED', targetId: first.id } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { aggregateId: first.id, eventType: 'billing.price.published' } })).resolves.toBe(1);
  });
});
