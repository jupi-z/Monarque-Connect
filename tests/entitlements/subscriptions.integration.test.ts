import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { createTestPool } from '../events/test-database.js';
import { seedReferenceData } from '../../prisma/seed.js';
import { PrismaOutboxWriter } from '../../src/events/prisma-outbox.writer.js';
import { SubscriptionService } from '../../src/entitlements/subscription.service.js';

describe('Organization subscriptions', () => {
  const connectionString =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const subscriptions = new SubscriptionService(prisma as never, new PrismaOutboxWriter());
  const organizationId = crypto.randomUUID();

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    const pool = createTestPool();
    await pool.query('TRUNCATE TABLE subscriptions, audit_events, organizations, business_types, outbox_events RESTART IDENTITY CASCADE');
    await pool.end();
    await seedReferenceData(prisma);
    await prisma.organization.create({
      data: {
        id: organizationId,
        businessTypeCode: 'COMMERCE_DISTRIBUTION',
        name: 'Subscription tenant',
        handle: 'subscription-tenant',
        defaultCurrency: 'EUR',
      },
    });
  });

  afterAll(async () => prisma.$disconnect());

  it('resolves an active subscription at the start and expires it at the exclusive end boundary', async () => {
    const planVersion = await prisma.planVersion.findUniqueOrThrow({
      where: { planCode_version: { planCode: 'CONNECT', version: 1 } },
    });
    const startsAt = new Date('2026-11-01T00:00:00.000Z');
    const endsAt = new Date('2026-12-01T00:00:00.000Z');

    const created = await subscriptions.create({ organizationId, planVersionId: planVersion.id, startsAt, endsAt });

    await expect(subscriptions.resolveEffective(organizationId, startsAt)).resolves.toMatchObject({ id: created.id, status: 'ACTIVE' });
    await expect(subscriptions.resolveEffective(organizationId, new Date('2026-11-30T23:59:59.999Z'))).resolves.toMatchObject({ id: created.id });
    await expect(subscriptions.resolveEffective(organizationId, endsAt)).resolves.toBeNull();
    await expect(prisma.auditEvent.count({ where: { organizationId, action: 'SUBSCRIPTION_CREATED' } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { organizationId, eventType: 'subscription.created' } })).resolves.toBe(1);
  });

  it('applies only allowed lifecycle transitions and makes repeated transitions idempotent', async () => {
    const planVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'CONNECT', version: 1 } } });
    const created = await subscriptions.create({ organizationId, planVersionId: planVersion.id, startsAt: new Date('2026-11-01T00:00:00.000Z') });

    await expect(subscriptions.transition(created.id, 'PAST_DUE', new Date('2026-11-05T00:00:00.000Z'), 'payment retry')).resolves.toMatchObject({ status: 'PAST_DUE' });
    await expect(subscriptions.transition(created.id, 'ACTIVE', new Date('2026-11-06T00:00:00.000Z'), 'payment recovered')).resolves.toMatchObject({ status: 'ACTIVE' });
    await expect(subscriptions.transition(created.id, 'ACTIVE', new Date('2026-11-06T00:00:00.000Z'), 'duplicate callback')).resolves.toMatchObject({ status: 'ACTIVE' });
    await expect(subscriptions.transition(created.id, 'TRIALING', new Date('2026-11-07T00:00:00.000Z'), 'invalid downgrade')).rejects.toThrow();
    await expect(prisma.auditEvent.count({ where: { organizationId, action: 'SUBSCRIPTION_TRANSITIONED' } })).resolves.toBe(2);
    await expect(prisma.outboxEvent.count({ where: { organizationId, eventType: 'subscription.transitioned' } })).resolves.toBe(2);
  });
});
