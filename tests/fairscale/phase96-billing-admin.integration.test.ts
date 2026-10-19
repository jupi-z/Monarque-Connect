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
    await expect(admin.publishPrice(principal, { ...input, welcomeAmountMinor: 3900 }, 'admin-price-1')).rejects.toThrow('another price publication');
    await expect(prisma.auditEvent.count({ where: { actorUserId, action: 'BILLING_PRICE_VERSION_PUBLISHED', targetId: first.id } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { aggregateId: first.id, eventType: 'billing.price.published' } })).resolves.toBe(1);
  });

  it('records an idempotent platform verification decision for a BillingCustomer', async () => {
    const principal = { userId: actorUserId, sessionId: randomUUID() };
    const customer = await prisma.billingCustomer.create({ data: { id: randomUUID(), displayName: 'Verified FairScale customer', identityKey: `test:verification:${randomUUID()}` } });
    const verified = await admin.setCustomerVerification(principal, customer.id, { status: 'VERIFIED', reason: 'Validated commercial evidence' }, 'customer-verification-1') as { id: string; status: string; verifiedAt: string | null };
    expect(verified).toMatchObject({ id: customer.id, status: 'VERIFIED' });
    expect(verified.verifiedAt).toEqual(expect.any(String));
    await expect(admin.setCustomerVerification(principal, customer.id, { status: 'VERIFIED', reason: 'Validated commercial evidence' }, 'customer-verification-1')).resolves.toMatchObject({ id: customer.id, status: 'VERIFIED' });
    await expect(admin.setCustomerVerification(principal, customer.id, { status: 'SUSPENDED', reason: 'Different decision' }, 'customer-verification-1')).rejects.toThrow('another verification decision');
    await expect(prisma.auditEvent.count({ where: { actorUserId, action: 'BILLING_CUSTOMER_VERIFICATION_CHANGED', targetId: customer.id } })).resolves.toBe(1);
    await prisma.billingCustomer.delete({ where: { id: customer.id } });
  });

  it('prevents an organization from being linked to two commercial identities', async () => {
    const principal = { userId: actorUserId, sessionId: randomUUID() };
    const organization = await prisma.organization.create({ data: { id: randomUUID(), businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'Commercial identity tenant', handle: `commercial-${randomUUID().slice(0, 8)}`, defaultCurrency: 'EUR' } });
    const first = await prisma.billingCustomer.create({ data: { id: randomUUID(), displayName: 'First legal identity', identityKey: `test:first:${randomUUID()}` } });
    const second = await prisma.billingCustomer.create({ data: { id: randomUUID(), displayName: 'Second legal identity', identityKey: `test:second:${randomUUID()}` } });
    await expect(admin.linkOrganization(principal, first.id, organization.id, { reason: 'Validated legal evidence A' })).resolves.toMatchObject({ billingCustomerId: first.id, organizationId: organization.id });
    await expect(admin.linkOrganization(principal, first.id, organization.id, { reason: 'Replay of same link' })).resolves.toMatchObject({ billingCustomerId: first.id, organizationId: organization.id });
    await expect(admin.linkOrganization(principal, second.id, organization.id, { reason: 'Conflicting legal evidence' })).rejects.toThrow('already linked');
    await expect(prisma.auditEvent.count({ where: { action: 'BILLING_CUSTOMER_ORGANIZATION_LINKED', targetType: 'BillingCustomerOrganization', organizationId: organization.id } })).resolves.toBe(1);
    await prisma.organization.delete({ where: { id: organization.id } });
    await prisma.billingCustomer.deleteMany({ where: { id: { in: [first.id, second.id] } } });
  });
});
