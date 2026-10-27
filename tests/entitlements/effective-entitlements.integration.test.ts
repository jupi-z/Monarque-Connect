import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { createTestPool } from '../events/test-database.js';
import { seedReferenceData } from '../../prisma/seed.js';
import { PrismaOutboxWriter } from '../../src/events/prisma-outbox.writer.js';
import { SubscriptionService } from '../../src/entitlements/subscription.service.js';
import { EffectiveEntitlementsService } from '../../src/entitlements/effective-entitlements.service.js';
import { EntitlementOverrideService } from '../../src/entitlements/entitlement-override.service.js';
import { QuotaService } from '../../src/entitlements/quota.service.js';

describe('Effective organization entitlements', () => {
  const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const subscriptions = new SubscriptionService(prisma as never, new PrismaOutboxWriter());
  const entitlements = new EffectiveEntitlementsService(prisma as never, subscriptions);
  const overrides = new EntitlementOverrideService(prisma as never, new PrismaOutboxWriter());
  const quotas = new QuotaService(prisma as never, subscriptions, new PrismaOutboxWriter());
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

  async function createZamurekFeaturePlan() {
    const planCode = `ZAMUREK_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const moduleCode = `ZAMUREK_TEST_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await prisma.plan.create({ data: { code: planCode, name: 'ZAMUREK feature test plan', productCode: 'ZAMUREK' } });
    await prisma.moduleCatalog.create({ data: { code: moduleCode, displayName: 'ZAMUREK test feature', pillar: 'ZAMUREK', isCore: false } });
    await prisma.productModule.create({ data: { productCode: 'ZAMUREK', moduleCode } });
    const version = await prisma.planVersion.create({ data: { id: crypto.randomUUID(), productCode: 'ZAMUREK', planCode, version: 1, status: 'ACTIVE', currency: 'USD', billingPeriod: 'MONTHLY' } });
    await prisma.planVersionModule.create({ data: { planVersionId: version.id, productCode: 'ZAMUREK', moduleCode } });
    return { version, moduleCode };
  }

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

  it('keeps the legacy resolver scoped to Monarque Connect when ZAMUREK has its own subscription and overrides', async () => {
    const connectPlan = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'CONNECT', version: 1 } } });
    await subscriptions.create({ organizationId, planVersionId: connectPlan.id, startsAt: at });

    const zamurekPlanCode = `ZAMUREK_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await prisma.plan.create({ data: { code: zamurekPlanCode, name: 'ZAMUREK scoped test', productCode: 'ZAMUREK' } });
    const zamurekVersion = await prisma.planVersion.create({ data: { id: crypto.randomUUID(), productCode: 'ZAMUREK', planCode: zamurekPlanCode, version: 1, status: 'ACTIVE', currency: 'USD', billingPeriod: 'MONTHLY' } });
    await prisma.subscription.create({ data: { id: crypto.randomUUID(), organizationId, productCode: 'ZAMUREK', planVersionId: zamurekVersion.id, status: 'ACTIVE', startsAt: at } });
    const zamurekModuleCode = `ZAMUREK_TEST_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await prisma.moduleCatalog.create({ data: { code: zamurekModuleCode, displayName: 'ZAMUREK test feature', pillar: 'ZAMUREK', isCore: false } });
    await prisma.productModule.create({ data: { productCode: 'ZAMUREK', moduleCode: zamurekModuleCode } });
    await prisma.organizationEntitlement.create({ data: { id: crypto.randomUUID(), organizationId, productCode: 'ZAMUREK', moduleCode: zamurekModuleCode, effect: 'ALLOW', startsAt: at, reason: 'Product isolation test', createdByActor: 'PLATFORM:test' } });
    await prisma.organizationModuleActivation.create({ data: { id: crypto.randomUUID(), organizationId, productCode: 'ZAMUREK', moduleCode: zamurekModuleCode, enabled: false } });
    await expect(prisma.organizationEntitlement.create({ data: { id: crypto.randomUUID(), organizationId, productCode: 'ZAMUREK', moduleCode: 'CRM', effect: 'ALLOW', startsAt: at, reason: 'Must remain Connect-only', createdByActor: 'PLATFORM:test' } })).rejects.toThrow();

    const result = await entitlements.resolve(organizationId, at);

    expect(result.plan).toEqual({ code: 'CONNECT', version: 1 });
    expect(result.subscription).toMatchObject({ status: 'ACTIVE' });
    expect(result.modules).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CRM', allowed: false, reason: 'MODULE_NOT_INCLUDED' }),
      expect.objectContaining({ code: 'CATALOG', allowed: true, reason: 'PLAN_INCLUDED' }),
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
    await prisma.planVersionModule.create({ data: { planVersionId: planVersion.id, productCode: 'MONARQUE_CONNECT', moduleCode: 'SALES' } });
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

  it('separates plan inclusion from default activation and honors explicit activation', async () => {
    const planCode = `DEFAULT_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await prisma.plan.create({ data: { code: planCode, name: 'Default activation test' } });
    const planVersion = await prisma.planVersion.create({ data: { id: crypto.randomUUID(), planCode, version: 1, status: 'ACTIVE', currency: 'EUR', billingPeriod: 'MONTHLY' } });
    await prisma.planVersionModule.create({ data: { planVersionId: planVersion.id, productCode: 'MONARQUE_CONNECT', moduleCode: 'CATALOG', defaultEnabled: false } });
    await subscriptions.create({ organizationId, planVersionId: planVersion.id, startsAt: at });

    const disabled = await entitlements.resolve(organizationId, at);
    expect(disabled.modules).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'CATALOG', entitled: true, active: false, allowed: false, reason: 'MODULE_DEFAULT_DISABLED' })]));
    await prisma.organizationModuleActivation.create({ data: { id: crypto.randomUUID(), organizationId, moduleCode: 'CATALOG', enabled: true } });
    const enabled = await entitlements.resolve(organizationId, at);
    expect(enabled.modules).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'CATALOG', entitled: true, active: true, allowed: true })]));
  });

  it('applies ALLOW, DENY and LIMIT_OVERRIDE overrides with deterministic precedence', async () => {
    const planVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'CONNECT', version: 1 } } });
    await subscriptions.create({ organizationId, planVersionId: planVersion.id, startsAt: at });
    await overrides.set({ organizationId, moduleCode: 'EXPENSES', effect: 'ALLOW', reason: 'Pilot access', actorId: crypto.randomUUID(), startsAt: new Date('2026-10-01T00:00:00.000Z') });
    await overrides.set({ organizationId, moduleCode: 'CATALOG', effect: 'DENY', reason: 'Commercial hold', actorId: crypto.randomUUID(), startsAt: new Date('2026-10-01T00:00:00.000Z') });
    await overrides.set({ organizationId, moduleCode: 'CATALOG', effect: 'LIMIT_OVERRIDE', reason: 'Temporary quota', limits: { MAX_USERS: '2' }, actorId: crypto.randomUUID(), startsAt: new Date('2026-10-01T00:00:00.000Z') });

    const result = await entitlements.resolve(organizationId, at);
    expect(result.modules).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'EXPENSES', entitled: true, allowed: true, source: 'OVERRIDE', reason: 'EXPLICIT_ALLOW' }),
      expect.objectContaining({ code: 'CATALOG', entitled: false, allowed: false, reason: 'EXPLICIT_DENY', limitOverrides: { MAX_USERS: '2' } }),
    ]));
    await expect(prisma.auditEvent.count({ where: { organizationId, action: 'ENTITLEMENT_OVERRIDE_SET' } })).resolves.toBe(3);
    await expect(prisma.outboxEvent.count({ where: { organizationId, eventType: 'entitlement.override_set' } })).resolves.toBe(3);
    const legacyList = await overrides.list(organizationId);
    expect(legacyList).toHaveLength(3);
    expect(legacyList[0]).not.toHaveProperty('productCode');
  });

  it('rejects commercial overrides on core modules and ignores legacy core overrides', async () => {
    const planVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'CONNECT', version: 1 } } });
    await subscriptions.create({ organizationId, planVersionId: planVersion.id, startsAt: at });

    await expect(overrides.set({ organizationId, moduleCode: 'AUTH', effect: 'DENY', reason: 'Must be rejected', actorId: crypto.randomUUID(), startsAt: at })).rejects.toThrow('Core modules cannot receive commercial entitlement overrides');
    await prisma.organizationEntitlement.create({ data: { id: crypto.randomUUID(), organizationId, moduleCode: 'AUTH', effect: 'DENY', startsAt: at, reason: 'Legacy invalid override', createdByActor: 'PLATFORM:test' } });

    const result = await entitlements.resolve(organizationId, at);
    expect(result.modules).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'AUTH', entitled: true, active: true, allowed: true, reason: 'CORE_MODULE', source: 'CORE' })]));
  });

  it('persists business-type recommendations and enforces the intelligence active-module rule', async () => {
    const seeded = await entitlements.resolve(organizationId, at);
    expect(seeded.modules).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'CATALOG', recommended: true })]));

    const planCode = `INTEL_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await prisma.plan.create({ data: { code: planCode, name: 'Intelligence only test' } });
    const planVersion = await prisma.planVersion.create({ data: { id: crypto.randomUUID(), planCode, version: 1, status: 'ACTIVE', currency: 'EUR', billingPeriod: 'MONTHLY' } });
    await prisma.planVersionModule.create({ data: { planVersionId: planVersion.id, productCode: 'MONARQUE_CONNECT', moduleCode: 'INTELLIGENCE_BASIC' } });
    await subscriptions.create({ organizationId, planVersionId: planVersion.id, startsAt: new Date('2027-01-01T00:00:00.000Z') });
    const intelligence = await entitlements.resolve(organizationId, new Date('2027-01-02T00:00:00.000Z'));
    expect(intelligence.modules).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'INTELLIGENCE_BASIC', entitled: true, allowed: false, reason: 'MODULE_REQUIRES_ACTIVE_MODULE' })]));
  });

  it('denies every module immediately when the organization is suspended', async () => {
    const planVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'CONNECT', version: 1 } } });
    await subscriptions.create({ organizationId, planVersionId: planVersion.id, startsAt: at });
    await prisma.organization.update({ where: { id: organizationId }, data: { status: 'SUSPENDED' } });

    const result = await entitlements.resolve(organizationId, at);
    expect(result.subscription).toBeNull();
    expect(result.modules).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'AUTH', entitled: false, active: false, allowed: false, reason: 'ORGANIZATION_SUSPENDED' }),
      expect.objectContaining({ code: 'CATALOG', entitled: false, active: false, allowed: false, reason: 'ORGANIZATION_SUSPENDED' }),
    ]));
  });

  it('resolves product modules independently and applies product then global suspension precedence', async () => {
    const connectVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'CONNECT', version: 1 } } });
    await subscriptions.create({ organizationId, planVersionId: connectVersion.id, startsAt: at });
    const { version, moduleCode } = await createZamurekFeaturePlan();
    const zamurekSubscription = await subscriptions.createForProduct('ZAMUREK', { organizationId, planVersionId: version.id, startsAt: at });

    const zamurek = await entitlements.resolveForProduct(organizationId, 'ZAMUREK', at);
    expect(zamurek).toMatchObject({ productCode: 'ZAMUREK', plan: { code: version.planCode }, subscription: { id: zamurekSubscription.id, status: 'ACTIVE' } });
    expect(zamurek.modules).toEqual(expect.arrayContaining([expect.objectContaining({ code: moduleCode, entitled: true, allowed: true, reason: 'PLAN_INCLUDED' })]));
    expect(zamurek.modules.some((module) => module.code === 'CRM' || module.code === 'SALES')).toBe(false);

    await subscriptions.transitionForProduct(zamurekSubscription.id, 'ZAMUREK', 'SUSPENDED', new Date(at.getTime() + 1000), 'product suspension test');
    const suspendedZamurek = await entitlements.resolveForProduct(organizationId, 'ZAMUREK', new Date(at.getTime() + 2000));
    expect(suspendedZamurek.subscription).toBeNull();
    expect(suspendedZamurek.modules).toEqual(expect.arrayContaining([expect.objectContaining({ code: moduleCode, allowed: false, reason: 'SUBSCRIPTION_INACTIVE' })]));
    const activeConnect = await entitlements.resolve(organizationId, new Date(at.getTime() + 2000));
    expect(activeConnect.modules).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'CATALOG', allowed: true, reason: 'PLAN_INCLUDED' })]));

    await prisma.organization.update({ where: { id: organizationId }, data: { status: 'SUSPENDED' } });
    const globallySuspendedConnect = await entitlements.resolve(organizationId, new Date(at.getTime() + 3000));
    const globallySuspendedZamurek = await entitlements.resolveForProduct(organizationId, 'ZAMUREK', new Date(at.getTime() + 3000));
    expect(globallySuspendedConnect.modules).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'AUTH', allowed: false, reason: 'ORGANIZATION_SUSPENDED' })]));
    expect(globallySuspendedZamurek.modules).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'AUTH', allowed: false, reason: 'ORGANIZATION_SUSPENDED' })]));
  });

  it('keeps product overrides isolated and rejects modules not mapped to that product', async () => {
    const connectVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'CONNECT', version: 1 } } });
    await subscriptions.create({ organizationId, planVersionId: connectVersion.id, startsAt: at });
    const { version, moduleCode } = await createZamurekFeaturePlan();
    await subscriptions.createForProduct('ZAMUREK', { organizationId, planVersionId: version.id, startsAt: at });
    await overrides.setForProduct('ZAMUREK', { organizationId, moduleCode, effect: 'ALLOW', reason: 'ZAMUREK pilot entitlement', actorId: crypto.randomUUID(), startsAt: at });

    const zamurek = await entitlements.resolveForProduct(organizationId, 'ZAMUREK', at);
    const connect = await entitlements.resolve(organizationId, at);
    expect(zamurek.modules).toEqual(expect.arrayContaining([expect.objectContaining({ code: moduleCode, allowed: true, source: 'OVERRIDE', reason: 'EXPLICIT_ALLOW' })]));
    expect(connect.modules).toEqual(expect.arrayContaining([expect.objectContaining({ code: moduleCode, allowed: false, reason: 'MODULE_NOT_INCLUDED' })]));
    await expect(overrides.setForProduct('ZAMUREK', { organizationId, moduleCode: 'CRM', effect: 'ALLOW', reason: 'Must stay Connect-only', actorId: crypto.randomUUID(), startsAt: at })).rejects.toThrow('Module is not registered for this product');
    await expect(overrides.setForProduct('ZAMUREK', { organizationId, moduleCode: 'AUTH', effect: 'ALLOW', reason: 'Core cannot be overridden', actorId: crypto.randomUUID(), startsAt: at })).rejects.toThrow('Core modules cannot receive commercial entitlement overrides');
    await expect(prisma.planVersionModule.create({ data: { planVersionId: version.id, productCode: 'ZAMUREK', moduleCode: 'CRM' } })).rejects.toThrow();
  });

  it('isolates quota reservation, completion and usage by product', async () => {
    const connectVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'CONNECT', version: 1 } } });
    await subscriptions.create({ organizationId, planVersionId: connectVersion.id, startsAt: at });
    const planCode = `ZAMUREK_QUOTA_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await prisma.plan.create({ data: { code: planCode, name: 'ZAMUREK quota test plan', productCode: 'ZAMUREK' } });
    const version = await prisma.planVersion.create({ data: { id: crypto.randomUUID(), productCode: 'ZAMUREK', planCode, version: 1, status: 'ACTIVE', currency: 'USD', billingPeriod: 'MONTHLY' } });
    await prisma.planVersionQuota.create({ data: { id: crypto.randomUUID(), planVersionId: version.id, quotaCode: 'MAX_USERS', unit: 'COUNT', mode: 'CAPACITY', limitValue: 2n } });
    await subscriptions.createForProduct('ZAMUREK', { organizationId, planVersionId: version.id, startsAt: at });

    const idempotencyKey = `same-key-${crypto.randomUUID()}`;
    const zReservation = await quotas.reserveForProduct('ZAMUREK', { organizationId, quotaCode: 'MAX_USERS', amount: 1n, idempotencyKey });
    const connectReservation = await quotas.reserveForProduct('MONARQUE_CONNECT', { organizationId, quotaCode: 'MAX_USERS', amount: 1n, idempotencyKey });
    expect(zReservation.id).not.toBe(connectReservation.id);
    await expect(quotas.commitForProduct(zReservation.id, 'MONARQUE_CONNECT')).rejects.toThrow();
    await quotas.commitForProduct(zReservation.id, 'ZAMUREK');

    const zQuotas = await quotas.listForProduct('ZAMUREK', organizationId, at);
    const connectQuotas = await quotas.listForProduct('MONARQUE_CONNECT', organizationId, at);
    expect(zQuotas).toEqual(expect.arrayContaining([expect.objectContaining({ quotaCode: 'MAX_USERS', used: '1', reserved: '0' })]));
    expect(connectQuotas).toEqual(expect.arrayContaining([expect.objectContaining({ quotaCode: 'MAX_USERS', used: '0', reserved: '1' })]));
  });

  it('does not apply an implicit grace period to a new product and rejects inactive products', async () => {
    const { version } = await createZamurekFeaturePlan();
    const end = new Date(at.getTime() + 1000);
    const subscription = await subscriptions.createForProduct('ZAMUREK', { organizationId, planVersionId: version.id, startsAt: at, endsAt: end });
    await subscriptions.transitionForProduct(subscription.id, 'ZAMUREK', 'PAST_DUE', end, 'grace policy test');
    const afterPeriod = await subscriptions.resolveEffectiveForProduct(organizationId, 'ZAMUREK', new Date(end.getTime() + 1));
    expect(afterPeriod).toBeNull();
    await prisma.productCatalog.update({ where: { code: 'ZAMUREK' }, data: { active: false } });
    await expect(entitlements.resolveForProduct(organizationId, 'ZAMUREK', at)).rejects.toThrow('Product not found or inactive');
    await expect(subscriptions.createForProduct('ZAMUREK', { organizationId, planVersionId: version.id, startsAt: new Date(end.getTime() + 5000) })).rejects.toThrow('Product not found or inactive');
  });
});
