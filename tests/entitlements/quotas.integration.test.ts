import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { createTestPool } from '../events/test-database.js';
import { seedReferenceData } from '../../prisma/seed.js';
import { PrismaOutboxWriter } from '../../src/events/prisma-outbox.writer.js';
import { SubscriptionService } from '../../src/entitlements/subscription.service.js';
import { QuotaService } from '../../src/entitlements/quota.service.js';

describe('Organization quota reservations', () => {
  const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const outbox = new PrismaOutboxWriter();
  const subscriptions = new SubscriptionService(prisma as never, outbox);
  const quotas = new QuotaService(prisma as never, subscriptions, outbox);
  let organizationId: string;

  beforeAll(async () => prisma.$connect());

  beforeEach(async () => {
    const pool = createTestPool();
    await pool.query('TRUNCATE TABLE quota_ledgers, quota_reservations, organization_quota_usages, subscriptions, audit_events, organizations, business_types, outbox_events RESTART IDENTITY CASCADE');
    await pool.end();
    await seedReferenceData(prisma);
    organizationId = crypto.randomUUID();
    await prisma.organization.create({ data: { id: organizationId, businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'Quota tenant', handle: `quota-${organizationId.slice(0, 8)}`, defaultCurrency: 'EUR' } });
    const planVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'CONNECT', version: 1 } } });
    await subscriptions.create({ organizationId, planVersionId: planVersion.id, startsAt: new Date('2026-10-01T00:00:00.000Z') });
  });

  afterAll(async () => prisma.$disconnect());

  it('reserves atomically against the persisted plan limit and makes retries idempotent', async () => {
    const first = await quotas.reserve({ organizationId, quotaCode: 'MAX_USERS', amount: 3n, at: new Date('2026-10-15T00:00:00.000Z'), idempotencyKey: 'invite-batch-1' });
    const retry = await quotas.reserve({ organizationId, quotaCode: 'MAX_USERS', amount: 3n, at: new Date('2026-10-15T00:00:00.000Z'), idempotencyKey: 'invite-batch-1' });

    expect(retry).toMatchObject({ id: first.id, status: 'HELD', amount: 3n, limit: 5n });
    await expect(prisma.organizationQuotaUsage.findUnique({ where: { organizationId_productCode_quotaCode_periodKey: { productCode: 'MONARQUE_CONNECT', organizationId, quotaCode: 'MAX_USERS', periodKey: 'CURRENT' } } })).resolves.toMatchObject({ usedValue: 0n, reservedValue: 3n, limitValue: 5n });
    await expect(prisma.quotaLedger.count({ where: { organizationId, quotaCode: 'MAX_USERS' } })).resolves.toBe(1);
  });

  it('allows only capacity-fitting concurrent reservations', async () => {
    const results = await Promise.allSettled([
      quotas.reserve({ organizationId, quotaCode: 'MAX_USERS', amount: 2n, at: new Date('2026-10-15T00:00:00.000Z'), idempotencyKey: 'concurrent-1' }),
      quotas.reserve({ organizationId, quotaCode: 'MAX_USERS', amount: 2n, at: new Date('2026-10-15T00:00:00.000Z'), idempotencyKey: 'concurrent-2' }),
      quotas.reserve({ organizationId, quotaCode: 'MAX_USERS', amount: 2n, at: new Date('2026-10-15T00:00:00.000Z'), idempotencyKey: 'concurrent-3' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await expect(prisma.organizationQuotaUsage.findUnique({ where: { organizationId_productCode_quotaCode_periodKey: { productCode: 'MONARQUE_CONNECT', organizationId, quotaCode: 'MAX_USERS', periodKey: 'CURRENT' } } })).resolves.toMatchObject({ usedValue: 0n, reservedValue: 4n, limitValue: 5n });
  });

  it('commits and releases reservations exactly once with auditable events', async () => {
    const held = await quotas.reserve({ organizationId, quotaCode: 'MAX_USERS', amount: 2n, at: new Date('2026-10-15T00:00:00.000Z'), idempotencyKey: 'commit-1' });
    await expect(quotas.commit(held.id)).resolves.toMatchObject({ id: held.id, status: 'COMMITTED' });
    await expect(quotas.commit(held.id)).resolves.toMatchObject({ id: held.id, status: 'COMMITTED' });
    const released = await quotas.reserve({ organizationId, quotaCode: 'MAX_USERS', amount: 1n, at: new Date('2026-10-15T00:00:00.000Z'), idempotencyKey: 'release-1' });
    await expect(quotas.release(released.id)).resolves.toMatchObject({ id: released.id, status: 'RELEASED' });
    await expect(quotas.release(released.id)).resolves.toMatchObject({ id: released.id, status: 'RELEASED' });

    await expect(prisma.organizationQuotaUsage.findUnique({ where: { organizationId_productCode_quotaCode_periodKey: { productCode: 'MONARQUE_CONNECT', organizationId, quotaCode: 'MAX_USERS', periodKey: 'CURRENT' } } })).resolves.toMatchObject({ usedValue: 2n, reservedValue: 0n });
    await expect(prisma.auditEvent.count({ where: { organizationId, action: { in: ['QUOTA_RESERVED', 'QUOTA_COMMITTED', 'QUOTA_RELEASED'] } } })).resolves.toBe(4);
    await expect(prisma.outboxEvent.count({ where: { organizationId, eventType: { in: ['quota.reserved', 'quota.committed', 'quota.released'] } } })).resolves.toBe(4);
  });

  it('derives the period on the server and applies an entitlement limit override', async () => {
    await prisma.organizationEntitlement.create({ data: { id: crypto.randomUUID(), organizationId, moduleCode: 'MEMBERSHIPS', effect: 'LIMIT_OVERRIDE', startsAt: new Date('2026-10-01T00:00:00.000Z'), reason: 'Temporary cap', limitsJson: { MAX_USERS: '2' }, createdByActor: 'PLATFORM:test' } });
    await expect(quotas.reserve({ organizationId, quotaCode: 'MAX_USERS', amount: 3n, at: new Date('2026-10-15T00:00:00.000Z'), idempotencyKey: 'override-cap' })).rejects.toThrow('Quota capacity exceeded');
    await expect(quotas.list(organizationId, new Date('2026-10-15T00:00:00.000Z'))).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ quotaCode: 'MAX_USERS', mode: 'CAPACITY', limit: '2', periodKey: 'CURRENT' })]));
    await expect(quotas.reserve({ organizationId, quotaCode: 'MAX_USERS', amount: 1n, at: new Date('2026-11-15T00:00:00.000Z'), idempotencyKey: 'canonical-november' })).resolves.toMatchObject({ periodKey: 'CURRENT' });
    await expect(prisma.organizationQuotaUsage.findUnique({ where: { organizationId_productCode_quotaCode_periodKey: { productCode: 'MONARQUE_CONNECT', organizationId, quotaCode: 'MAX_USERS', periodKey: 'CURRENT' } } })).resolves.toMatchObject({ reservedValue: 1n });
  });

  it('ignores a limit override attached to an unrelated module', async () => {
    await prisma.organizationEntitlement.create({ data: { id: crypto.randomUUID(), organizationId, moduleCode: 'CATALOG', effect: 'LIMIT_OVERRIDE', startsAt: new Date('2026-10-01T00:00:00.000Z'), reason: 'Unrelated cap', limitsJson: { MAX_USERS: '2' }, createdByActor: 'PLATFORM:test' } });

    await expect(quotas.reserve({ organizationId, quotaCode: 'MAX_USERS', amount: 3n, at: new Date('2026-10-15T00:00:00.000Z'), idempotencyKey: 'unrelated-override' })).resolves.toMatchObject({ limit: 5n });
    await expect(quotas.list(organizationId, new Date('2026-10-15T00:00:00.000Z'))).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ quotaCode: 'MAX_USERS', mode: 'CAPACITY', limit: '5', periodKey: 'CURRENT' })]));
  });

  it('does not reset capacity quotas when the billing period changes', async () => {
    const held = await quotas.reserve({ organizationId, quotaCode: 'MAX_USERS', amount: 5n, at: new Date('2026-10-15T00:00:00.000Z'), idempotencyKey: 'capacity-october' });
    await quotas.commit(held.id);

    await expect(quotas.reserve({ organizationId, quotaCode: 'MAX_USERS', amount: 1n, at: new Date('2026-11-15T00:00:00.000Z'), idempotencyKey: 'capacity-november' })).rejects.toThrow('Quota capacity exceeded');
    await expect(prisma.organizationQuotaUsage.findUnique({ where: { organizationId_productCode_quotaCode_periodKey: { productCode: 'MONARQUE_CONNECT', organizationId, quotaCode: 'MAX_USERS', periodKey: 'CURRENT' } } })).resolves.toMatchObject({ usedValue: 5n, reservedValue: 0n });
  });

  it('does not apply a commercial MAX_USERS limit to paid FairScale plans', async () => {
    await prisma.billingCustomer.create({
      data: {
        id: crypto.randomUUID(),
        displayName: 'Verified FairScale customer',
        status: 'VERIFIED',
        verifiedAt: new Date(),
        organizations: { create: { organizationId, role: 'OWNER', evidenceJson: { source: 'test' }, verifiedAt: new Date() } },
      },
    });
    const paidPlan = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'OPERATIONS', version: 1 } } });
    await prisma.subscription.updateMany({ where: { organizationId }, data: { planVersionId: paidPlan.id, startsAt: new Date('2020-01-01T00:00:00.000Z') } });

    await expect(prisma.$transaction((tx) => quotas.consume(tx, { organizationId, quotaCode: 'MAX_USERS', amount: 1000n, idempotencyKey: 'paid-user-capacity', resourceType: 'Membership', resourceId: crypto.randomUUID() }))).resolves.toMatchObject({ amount: 1000n, status: 'COMMITTED' });
    await expect(prisma.organizationQuotaUsage.findFirst({ where: { organizationId, quotaCode: 'MAX_USERS' } })).resolves.toBeNull();
    await expect(quotas.list(organizationId)).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ quotaCode: 'MAX_USERS' })]));
  });

  it('uses the FairScale included establishment capacity for paid plans', async () => {
    await prisma.billingCustomer.create({
      data: {
        id: crypto.randomUUID(),
        displayName: 'Verified FairScale customer',
        status: 'VERIFIED',
        verifiedAt: new Date(),
        organizations: { create: { organizationId, role: 'OWNER', evidenceJson: { source: 'test' }, verifiedAt: new Date() } },
      },
    });
    const paidPlan = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'BUSINESS', version: 1 } } });
    await prisma.subscription.updateMany({ where: { organizationId }, data: { planVersionId: paidPlan.id, startsAt: new Date('2020-01-01T00:00:00.000Z') } });

    await expect(prisma.$transaction((tx) => quotas.consume(tx, { organizationId, quotaCode: 'MAX_ESTABLISHMENTS', amount: 3n, idempotencyKey: 'paid-establishments-3', resourceType: 'Establishment', resourceId: crypto.randomUUID() }))).resolves.toMatchObject({ amount: 3n, limit: 3n, status: 'COMMITTED' });
    await expect(prisma.$transaction((tx) => quotas.consume(tx, { organizationId, quotaCode: 'MAX_ESTABLISHMENTS', amount: 1n, idempotencyKey: 'paid-establishments-over', resourceType: 'Establishment', resourceId: crypto.randomUUID() }))).rejects.toThrow('Quota capacity exceeded');
  });
});
