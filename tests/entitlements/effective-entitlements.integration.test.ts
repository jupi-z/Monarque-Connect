import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { createTestPool } from '../events/test-database.js';
import { seedReferenceData } from '../../prisma/seed.js';
import { PrismaOutboxWriter } from '../../src/events/prisma-outbox.writer.js';
import { SubscriptionService } from '../../src/entitlements/subscription.service.js';
import { EffectiveEntitlementsService } from '../../src/entitlements/effective-entitlements.service.js';

describe('Effective organization entitlements', () => {
  const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const subscriptions = new SubscriptionService(prisma as never, new PrismaOutboxWriter());
  const entitlements = new EffectiveEntitlementsService(prisma as never, subscriptions);
  let organizationId: string;
  const at = new Date('2026-11-01T00:00:00.000Z');

  beforeAll(async () => prisma.$connect());

  beforeEach(async () => {
    organizationId = crypto.randomUUID();
    const pool = createTestPool();
    await pool.query('TRUNCATE TABLE subscriptions, audit_events, organizations, business_types, outbox_events RESTART IDENTITY CASCADE');
    await pool.end();
    await seedReferenceData(prisma);
    await prisma.organization.create({ data: { id: organizationId, businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'Entitlement tenant', handle: `entitlement-${organizationId.slice(0, 8)}`, defaultCurrency: 'EUR' } });
  });

  afterAll(async () => prisma.$disconnect());

  it('returns a versioned projection with core access, included modules and explicit denials', async () => {
    const planVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'CONNECT', version: 1 } } });
    await subscriptions.create({ organizationId, planVersionId: planVersion.id, startsAt: at });

    const result = await entitlements.resolve(organizationId, at);

    expect(result).toMatchObject({ capabilitiesVersion: 1, organizationId, plan: { code: 'CONNECT', version: 1 }, subscription: { status: 'ACTIVE' } });
    expect(result.modules).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'AUTH', isCore: true, allowed: true, reason: 'CORE_MODULE', source: 'CORE' }),
      expect.objectContaining({ code: 'CATALOG', allowed: true, reason: 'PLAN_INCLUDED', source: 'PLAN' }),
      expect.objectContaining({ code: 'SALES', allowed: false, reason: 'MODULE_NOT_INCLUDED', source: 'PLAN' }),
    ]));
  });

  it('denies commercial modules without an effective subscription while preserving core access', async () => {
    const result = await entitlements.resolve(organizationId, at);

    expect(result.subscription).toBeNull();
    expect(result.modules).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'AUTH', allowed: true, reason: 'CORE_MODULE' }),
      expect.objectContaining({ code: 'CATALOG', allowed: false, reason: 'NO_ACTIVE_SUBSCRIPTION' }),
    ]));
  });

  it('reports inactive subscription state instead of treating it as an entitlement', async () => {
    const planVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'CONNECT', version: 1 } } });
    const created = await subscriptions.create({ organizationId, planVersionId: planVersion.id, startsAt: at });
    await subscriptions.transition(created.id, 'SUSPENDED', new Date('2026-11-02T00:00:00.000Z'), 'manual suspension');

    const result = await entitlements.resolve(organizationId, new Date('2026-11-03T00:00:00.000Z'));

    expect(result.subscription).toBeNull();
    expect(result.modules).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'CATALOG', allowed: false, reason: 'SUBSCRIPTION_INACTIVE' })]));
  });

  it('denies an included module when one of its catalog dependencies is not included', async () => {
    const planCode = `DEPENDENCY_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await prisma.plan.create({ data: { code: planCode, name: 'Dependency test' } });
    const planVersion = await prisma.planVersion.create({ data: { id: crypto.randomUUID(), planCode, version: 1, status: 'ACTIVE', currency: 'EUR', billingPeriod: 'MONTHLY' } });
    await prisma.planVersionModule.create({ data: { planVersionId: planVersion.id, moduleCode: 'SALES' } });
    await subscriptions.create({ organizationId, planVersionId: planVersion.id, startsAt: at });

    const result = await entitlements.resolve(organizationId, at);

    expect(result.modules).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SALES', allowed: false, reason: 'DEPENDENCY_NOT_ENTITLED', dependencies: ['CATALOG'] }),
    ]));
  });

  it('removes access immediately when a commercial module is explicitly deactivated', async () => {
    const planVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'CONNECT', version: 1 } } });
    await subscriptions.create({ organizationId, planVersionId: planVersion.id, startsAt: at });
    await prisma.organizationModuleActivation.create({ data: { id: crypto.randomUUID(), organizationId, moduleCode: 'NETWORK_PROFILE', enabled: false } });

    const result = await entitlements.resolve(organizationId, at);

    expect(result.modules).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'NETWORK_PROFILE', entitled: true, active: false, allowed: false, reason: 'MODULE_DEACTIVATED' }),
      expect.objectContaining({ code: 'NETWORK_INQUIRIES', allowed: false, reason: 'DEPENDENCY_NOT_ENTITLED' }),
    ]));
  });
});
