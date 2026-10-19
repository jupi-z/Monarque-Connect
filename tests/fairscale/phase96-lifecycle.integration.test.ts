import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { seedReferenceData } from '../../prisma/seed.js';
import { PrismaOutboxWriter } from '../../src/events/prisma-outbox.writer.js';
import { BillingLifecycleService } from '../../src/billing/billing-lifecycle.service.js';
import { BillingProviderService } from '../../src/billing/billing-provider.service.js';

describe('FairScale billing lifecycle', () => {
  const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const lifecycle = new BillingLifecycleService(prisma as never, undefined as never, new PrismaOutboxWriter());
  const provider = new BillingProviderService(prisma as never, new PrismaOutboxWriter());

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE billing_refunds, billing_payments, billing_payment_attempts, billing_invoices, billing_scheduled_changes, billing_subscription_addons, billing_subscription_terms, billing_checkout_orders, billing_quotes, billing_promotion_redemptions, billing_promotion_eligibilities, billing_customer_organizations, billing_customers, outbox_events, audit_events, subscriptions, organizations, business_types RESTART IDENTITY CASCADE`);
    await seedReferenceData(prisma);
  });

  afterAll(async () => prisma.$disconnect());

  it('issues one renewal invoice, verifies it once and advances the same term', async () => {
    const fixture = await createTerm('renewal-tenant', new Date('2026-01-31T00:00:00.000Z'), new Date('2026-01-31T00:00:00.000Z'));
    const issued = await lifecycle.renewDueTerms(fixture.currentPeriodEnd, 100, 'TEST');
    expect(issued).toMatchObject({ invoicesIssued: 1, paymentAttemptsCreated: 1 });

    const attempt = await prisma.billingPaymentAttempt.findFirstOrThrow({ where: { invoiceId: { not: null } } });
    const payload = { providerPaymentId: attempt.providerPaymentId, amountMinor: Number(attempt.amountMinor), currency: 'USD', status: 'SUCCEEDED' };
    const signature = createHmac('sha256', process.env.FAIRSCALE_BILLING_WEBHOOK_SECRET ?? 'test-fairscale-webhook-secret').update(JSON.stringify(payload)).digest('hex');
    await expect(provider.receiveWebhook('TEST', 'renewal-event-1', signature, payload)).resolves.toMatchObject({ accepted: true, duplicate: false });
    await expect(provider.receiveWebhook('TEST', 'renewal-event-1', signature, payload)).resolves.toMatchObject({ accepted: true, duplicate: true });

    const invoice = await prisma.billingInvoice.findFirstOrThrow({ where: { id: attempt.invoiceId! } });
    const term = await prisma.billingSubscriptionTerm.findUniqueOrThrow({ where: { id: fixture.id } });
    expect(invoice).toMatchObject({ status: 'PAID', amountPaidMinor: 4500n });
    expect(term).toMatchObject({ status: 'ACTIVE', nextRenewalAt: new Date('2026-02-28T00:00:00.000Z') });
    await expect(prisma.billingPayment.count({ where: { invoiceId: invoice.id } })).resolves.toBe(1);
    await expect(prisma.billingProviderEventInbox.count({ where: { providerEventId: 'renewal-event-1' } })).resolves.toBe(1);
  });

  it('moves an unpaid renewal through the seven-day dunning window without deleting history', async () => {
    const fixture = await createTerm('dunning-tenant', new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-01T00:00:00.000Z'));
    await expect(lifecycle.renewDueTerms(fixture.currentPeriodEnd)).resolves.toMatchObject({ invoicesIssued: 1, paymentAttemptsCreated: 0 });
    const invoice = await prisma.billingInvoice.findFirstOrThrow({ where: { subscriptionTermId: fixture.id } });

    await expect(lifecycle.runDunning(new Date('2026-01-02T00:00:00.000Z'))).resolves.toMatchObject({ pastDue: 1, suspended: 0 });
    await expect(prisma.billingSubscriptionTerm.findUniqueOrThrow({ where: { id: fixture.id } })).resolves.toMatchObject({ status: 'PAST_DUE' });
    await expect(lifecycle.runDunning(new Date('2026-01-09T00:00:00.000Z'))).resolves.toMatchObject({ pastDue: 0, suspended: 1 });
    await expect(prisma.billingSubscriptionTerm.findUniqueOrThrow({ where: { id: fixture.id } })).resolves.toMatchObject({ status: 'SUSPENDED' });
    await expect(prisma.billingInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).resolves.toMatchObject({ status: 'UNCOLLECTIBLE' });
    await expect(prisma.billingInvoice.count({ where: { id: invoice.id } })).resolves.toBe(1);
  });

  async function createTerm(handle: string, currentPeriodStart: Date, currentPeriodEnd: Date) {
    const organization = await prisma.organization.create({ data: { id: crypto.randomUUID(), businessTypeCode: 'COMMERCE_DISTRIBUTION', name: handle, handle, defaultCurrency: 'EUR' } });
    const customer = await prisma.billingCustomer.create({ data: { id: crypto.randomUUID(), identityKey: `test:${handle}`, displayName: handle, status: 'VERIFIED', verifiedAt: new Date(), organizations: { create: { organizationId: organization.id, role: 'OWNER' } } } });
    const plan = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'BUSINESS', version: 1 } } });
    const subscription = await prisma.subscription.create({ data: { id: crypto.randomUUID(), organizationId: organization.id, planVersionId: plan.id, status: 'ACTIVE', startsAt: new Date('2025-12-01T00:00:00.000Z'), endsAt: currentPeriodEnd } });
    return prisma.billingSubscriptionTerm.create({ data: { id: crypto.randomUUID(), billingCustomerId: customer.id, organizationId: organization.id, subscriptionId: subscription.id, status: 'ACTIVE', planCode: 'BUSINESS', billingPeriod: 'MONTHLY', currency: 'USD', catalogVersion: 1, baseAmountMinor: 4500n, discountAmountMinor: 0n, addonAmountMinor: 0n, totalAmountMinor: 4500n, startsAt: currentPeriodStart, currentPeriodStart, currentPeriodEnd, nextRenewalAt: currentPeriodEnd } });
  }
});
