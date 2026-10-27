import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { createTestPool } from '../events/test-database.js';
import { seedReferenceData } from '../../prisma/seed.js';

describe('product-scoped persistence constraints', () => {
  const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  let organizationId: string;

  beforeAll(async () => prisma.$connect());

  beforeEach(async () => {
    organizationId = crypto.randomUUID();
    const pool = createTestPool();
    await pool.query('TRUNCATE TABLE subscriptions, audit_events, organizations, business_types, outbox_events RESTART IDENTITY CASCADE');
    await pool.end();
    await seedReferenceData(prisma);
    await prisma.organization.create({ data: { id: organizationId, businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'Product scope tenant', handle: `product-${organizationId.slice(0, 8)}`, defaultCurrency: 'EUR' } });
  });

  afterAll(async () => prisma.$disconnect());

  async function createZamurekPlanVersion() {
    const planCode = `ZAMUREK_TEST_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await prisma.plan.create({ data: { code: planCode, name: 'ZAMUREK test plan', productCode: 'ZAMUREK' } });
    return prisma.planVersion.create({ data: { id: crypto.randomUUID(), productCode: 'ZAMUREK', planCode, version: 1, status: 'ACTIVE', currency: 'USD', billingPeriod: 'MONTHLY' } });
  }

  it('allows same-period subscriptions across products and rejects overlapping subscriptions within one product under concurrency', async () => {
    const connectPlan = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'CONNECT', version: 1 } } });
    const zamurekPlan = await createZamurekPlanVersion();
    const startsAt = new Date('2028-01-01T00:00:00.000Z');
    const endsAt = new Date('2028-02-01T00:00:00.000Z');

    await prisma.subscription.create({ data: { id: crypto.randomUUID(), organizationId, productCode: 'MONARQUE_CONNECT', planVersionId: connectPlan.id, status: 'ACTIVE', startsAt, endsAt } });
    await prisma.subscription.create({ data: { id: crypto.randomUUID(), organizationId, productCode: 'ZAMUREK', planVersionId: zamurekPlan.id, status: 'ACTIVE', startsAt, endsAt } });
    await expect(prisma.subscription.create({ data: { id: crypto.randomUUID(), organizationId, productCode: 'MONARQUE_CONNECT', planVersionId: zamurekPlan.id, status: 'ACTIVE', startsAt: new Date('2028-03-01T00:00:00.000Z'), endsAt: new Date('2028-04-01T00:00:00.000Z') } })).rejects.toThrow();

    const concurrent = await Promise.allSettled([
      prisma.subscription.create({ data: { id: crypto.randomUUID(), organizationId, productCode: 'ZAMUREK', planVersionId: zamurekPlan.id, status: 'ACTIVE', startsAt: new Date('2028-02-01T00:00:00.000Z'), endsAt: new Date('2028-03-01T00:00:00.000Z') } }),
      prisma.subscription.create({ data: { id: crypto.randomUUID(), organizationId, productCode: 'ZAMUREK', planVersionId: zamurekPlan.id, status: 'ACTIVE', startsAt: new Date('2028-02-15T00:00:00.000Z'), endsAt: new Date('2028-03-15T00:00:00.000Z') } }),
    ]);

    expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await expect(prisma.subscription.count({ where: { organizationId } })).resolves.toBe(3);
  });

  it('registers only shared Core modules for ZAMUREK until commercial capabilities are approved', async () => {
    const zamurekModules = await prisma.productModule.findMany({ where: { productCode: 'ZAMUREK', module: { pillar: { not: 'ZAMUREK' } } }, select: { module: { select: { code: true, isCore: true } } } });

    expect(zamurekModules.length).toBeGreaterThan(0);
    expect(zamurekModules.every(({ module }) => module.isCore)).toBe(true);
    expect(zamurekModules.map(({ module }) => module.code)).toContain('AUTH');
    expect(zamurekModules.map(({ module }) => module.code)).not.toContain('CRM');
    expect(zamurekModules.map(({ module }) => module.code)).not.toContain('SALES');
  });

  it('keeps activation, quota usage, reservations and ledger idempotency independent by product', async () => {
    const zamurekModuleCode = `ZAMUREK_TEST_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await prisma.moduleCatalog.create({ data: { code: zamurekModuleCode, displayName: 'ZAMUREK test feature', pillar: 'ZAMUREK', isCore: false } });
    await prisma.productModule.create({ data: { productCode: 'ZAMUREK', moduleCode: zamurekModuleCode } });
    await prisma.organizationModuleActivation.create({ data: { id: crypto.randomUUID(), organizationId, productCode: 'MONARQUE_CONNECT', moduleCode: 'CATALOG', enabled: true } });
    await prisma.organizationModuleActivation.create({ data: { id: crypto.randomUUID(), organizationId, productCode: 'ZAMUREK', moduleCode: zamurekModuleCode, enabled: true } });
    await expect(prisma.organizationModuleActivation.create({ data: { id: crypto.randomUUID(), organizationId, productCode: 'ZAMUREK', moduleCode: 'CRM', enabled: true } })).rejects.toThrow();
    for (const productCode of ['MONARQUE_CONNECT', 'ZAMUREK'] as const) {
      await prisma.organizationQuotaUsage.create({ data: { id: crypto.randomUUID(), organizationId, productCode, quotaCode: 'MAX_USERS', periodKey: 'CURRENT', limitValue: 10n } });
    }

    const reservations = await Promise.all(['MONARQUE_CONNECT', 'ZAMUREK'].map((productCode) => prisma.quotaReservation.create({ data: {
      id: crypto.randomUUID(), organizationId, productCode, quotaCode: 'MAX_USERS', periodKey: 'CURRENT', amount: 1n, limitValue: 10n, status: 'COMMITTED', idempotencyKey: 'same-operation-key',
    } })));
    for (const reservation of reservations) {
      await prisma.quotaLedger.create({ data: { id: crypto.randomUUID(), organizationId, productCode: reservation.productCode, quotaCode: reservation.quotaCode, periodKey: reservation.periodKey, reservationId: reservation.id, operation: 'COMMITTED', amount: reservation.amount } });
    }
    const zamurekReservation = reservations.find((reservation) => reservation.productCode === 'ZAMUREK');
    expect(zamurekReservation).toBeDefined();
    await expect(prisma.quotaLedger.create({ data: { id: crypto.randomUUID(), organizationId, productCode: 'MONARQUE_CONNECT', quotaCode: 'MAX_USERS', periodKey: 'CURRENT', reservationId: zamurekReservation!.id, operation: 'RESERVED', amount: 1n } })).rejects.toThrow();

    await expect(prisma.organizationModuleActivation.count({ where: { organizationId } })).resolves.toBe(2);
    await expect(prisma.organizationQuotaUsage.count({ where: { organizationId } })).resolves.toBe(2);
    await expect(prisma.quotaReservation.count({ where: { organizationId, idempotencyKey: 'same-operation-key' } })).resolves.toBe(2);
    await expect(prisma.quotaLedger.count({ where: { organizationId } })).resolves.toBe(2);
  });

  it('allows overlapping billing terms across products while retaining same-product exclusion', async () => {
    const connectPlan = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'CONNECT', version: 1 } } });
    const zamurekPlan = await createZamurekPlanVersion();
    const customer = await prisma.billingCustomer.create({ data: { id: crypto.randomUUID(), identityKey: `product-scope:${crypto.randomUUID()}`, displayName: 'Product scope test' } });
    const startsAt = new Date('2028-04-01T00:00:00.000Z');
    const periodEnd = new Date('2028-05-01T00:00:00.000Z');
    const connectSubscription = await prisma.subscription.create({ data: { id: crypto.randomUUID(), organizationId, productCode: 'MONARQUE_CONNECT', planVersionId: connectPlan.id, status: 'ACTIVE', startsAt, endsAt: new Date('2028-05-01T00:00:00.000Z') } });
    const zamurekSubscription = await prisma.subscription.create({ data: { id: crypto.randomUUID(), organizationId, productCode: 'ZAMUREK', planVersionId: zamurekPlan.id, status: 'ACTIVE', startsAt, endsAt: new Date('2028-05-01T00:00:00.000Z') } });
    const term = (subscriptionId: string, productCode: 'MONARQUE_CONNECT' | 'ZAMUREK') => ({ id: crypto.randomUUID(), billingCustomerId: customer.id, organizationId, subscriptionId, productCode, status: 'ACTIVE' as const, planCode: productCode === 'ZAMUREK' ? zamurekPlan.planCode : 'CONNECT', billingPeriod: 'MONTHLY' as const, currency: productCode === 'ZAMUREK' ? 'USD' : 'EUR', catalogVersion: 1, baseAmountMinor: 100n, discountAmountMinor: 0n, addonAmountMinor: 0n, totalAmountMinor: 100n, startsAt, currentPeriodStart: startsAt, currentPeriodEnd: periodEnd });

    await prisma.billingSubscriptionTerm.create({ data: term(connectSubscription.id, 'MONARQUE_CONNECT') });
    await prisma.billingSubscriptionTerm.create({ data: term(zamurekSubscription.id, 'ZAMUREK') });
    const laterZamurek = await prisma.subscription.create({ data: { id: crypto.randomUUID(), organizationId, productCode: 'ZAMUREK', planVersionId: zamurekPlan.id, status: 'ACTIVE', startsAt: periodEnd, endsAt: new Date('2028-06-01T00:00:00.000Z') } });

    await expect(prisma.billingSubscriptionTerm.create({ data: term(laterZamurek.id, 'ZAMUREK') })).rejects.toThrow();
    await expect(prisma.billingSubscriptionTerm.count({ where: { organizationId } })).resolves.toBe(2);
  });
});
