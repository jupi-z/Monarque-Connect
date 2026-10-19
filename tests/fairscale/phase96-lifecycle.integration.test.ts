import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
    expect(invoice).toMatchObject({ status: 'PAID', amountPaidMinor: 3825n, discountMinor: 675n });
    expect(term).toMatchObject({ status: 'ACTIVE', nextRenewalAt: new Date('2026-02-28T00:00:00.000Z') });
    await expect(prisma.billingPayment.count({ where: { invoiceId: invoice.id } })).resolves.toBe(1);
    await expect(prisma.billingProviderEventInbox.count({ where: { providerEventId: 'renewal-event-1' } })).resolves.toBe(1);
    await expect(prisma.billingPromotionEligibility.findFirstOrThrow({ where: { billingCustomerId: fixture.billingCustomerId, promotionCode: 'WELCOME_MONTHLY15' } })).resolves.toMatchObject({ monthlyPaidCount: 1 });
  });

  it('applies the monthly welcome discount to exactly the first three paid renewals', async () => {
    const fixture = await createTerm('renewal-promotion-window', new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-01T00:00:00.000Z'));
    const expected = [3825n, 3825n, 3825n, 4500n];

    for (let index = 0; index < expected.length; index += 1) {
      const dueAt = new Date(Date.UTC(2026, index, 1));
      await expect(lifecycle.renewDueTerms(dueAt, 100, 'TEST')).resolves.toMatchObject({ invoicesIssued: 1, paymentAttemptsCreated: 1 });
      const attempt = await prisma.billingPaymentAttempt.findFirstOrThrow({ where: { subscriptionTermId: fixture.id, status: 'REQUIRES_ACTION' }, orderBy: { createdAt: 'desc' } });
      const payload = { providerPaymentId: attempt.providerPaymentId, amountMinor: Number(attempt.amountMinor), currency: 'USD', status: 'SUCCEEDED' };
      const signature = createHmac('sha256', process.env.FAIRSCALE_BILLING_WEBHOOK_SECRET ?? 'test-fairscale-webhook-secret').update(JSON.stringify(payload)).digest('hex');
      await expect(provider.receiveWebhook('TEST', `renewal-promotion-${index + 1}`, signature, payload)).resolves.toMatchObject({ accepted: true, duplicate: false });
      const invoice = await prisma.billingInvoice.findFirstOrThrow({ where: { id: attempt.invoiceId! } });
      expect(invoice.amountPaidMinor).toBe(expected[index]);
      const term = await prisma.billingSubscriptionTerm.findUniqueOrThrow({ where: { id: fixture.id } });
      if (index < expected.length - 1) await prisma.billingSubscriptionTerm.update({ where: { id: fixture.id }, data: { nextRenewalAt: term.currentPeriodEnd } });
    }

    await expect(prisma.billingPromotionEligibility.findFirstOrThrow({ where: { billingCustomerId: fixture.billingCustomerId, promotionCode: 'WELCOME_MONTHLY15' } })).resolves.toMatchObject({ monthlyPaidCount: 3 });
  });

  it('rebuilds renewal addon charges from active addon quantities', async () => {
    const fixture = await createTerm('renewal-addons', new Date('2026-01-01T00:00:00.000Z'), new Date('2026-02-01T00:00:00.000Z'));
    await prisma.billingSubscriptionAddon.create({ data: { id: crypto.randomUUID(), subscriptionTermId: fixture.id, organizationId: fixture.organizationId, code: 'ESTABLISHMENT', status: 'ACTIVE', quantity: 2, billingPeriod: 'MONTHLY', currency: 'USD', unitAmountMinor: 1000n, startsAt: new Date('2026-01-01T00:00:00.000Z') } });
    await expect(lifecycle.renewDueTerms(fixture.currentPeriodEnd, 100, 'TEST')).resolves.toMatchObject({ invoicesIssued: 1, paymentAttemptsCreated: 1 });
    const invoice = await prisma.billingInvoice.findFirstOrThrow({ where: { subscriptionTermId: fixture.id } });
    expect(invoice).toMatchObject({ subtotalMinor: 6500n, totalMinor: 5825n, discountMinor: 675n });
    await expect(prisma.billingInvoiceLine.findFirstOrThrow({ where: { invoiceId: invoice.id, code: 'ADDON' } })).resolves.toMatchObject({ totalMinor: 2000n });
  });

  it('uses canonical end-of-month arithmetic for initial activation', async () => {
    const now = new Date('2026-01-31T00:00:00.000Z');
    const organization = await prisma.organization.create({ data: { id: crypto.randomUUID(), businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'initial-period-tenant', handle: 'initial-period-tenant', defaultCurrency: 'EUR' } });
    const customer = await prisma.billingCustomer.create({ data: { id: crypto.randomUUID(), identityKey: 'test:initial-period-tenant', displayName: 'initial-period-tenant', status: 'VERIFIED', verifiedAt: now, organizations: { create: { organizationId: organization.id, role: 'OWNER' } } } });
    const price = await prisma.priceVersion.findFirstOrThrow({ where: { planCode: 'BUSINESS', billingPeriod: 'MONTHLY', currency: 'USD', status: 'ACTIVE' } });
    const plan = await prisma.planVersion.findFirstOrThrow({ where: { planCode: 'BUSINESS', billingPeriod: 'MONTHLY', currency: 'USD', status: 'ACTIVE' } });
    const quote = await prisma.billingQuote.create({ data: { id: crypto.randomUUID(), organizationId: organization.id, billingCustomerId: customer.id, priceVersionId: price.id, idempotencyKey: 'initial-period-quote', status: 'ACCEPTED', planCode: 'BUSINESS', billingPeriod: 'MONTHLY', currency: 'USD', catalogVersion: price.version, baseAmountMinor: 4500n, discountAmountMinor: 0n, addonAmountMinor: 0n, totalAmountMinor: 4500n, activeEstablishmentCount: 3, includedEstablishments: 3, addonEstablishments: 0, promotionStatus: 'NONE', expiresAt: new Date('2026-02-15T00:00:00.000Z'), lines: { create: [{ id: crypto.randomUUID(), code: 'BASE_PLAN', description: 'FairScale monthly plan', quantity: 1, unitAmountMinor: 4500n, discountAmountMinor: 0n, totalAmountMinor: 4500n, currency: 'USD' }] } } });
    const order = await prisma.billingCheckoutOrder.create({ data: { id: crypto.randomUUID(), organizationId: organization.id, billingCustomerId: customer.id, quoteId: quote.id, idempotencyKey: 'initial-period-order', status: 'PAYMENT_PENDING', currency: 'USD', amountMinor: 4500n, expiresAt: new Date('2026-02-15T00:00:00.000Z') } });
    const attempt = await prisma.billingPaymentAttempt.create({ data: { id: crypto.randomUUID(), billingCustomerId: customer.id, organizationId: organization.id, checkoutOrderId: order.id, idempotencyKey: 'initial-period-attempt', provider: 'TEST', providerPaymentId: 'initial-period-payment', status: 'REQUIRES_ACTION', amountMinor: 4500n, currency: 'USD' } });

    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const payload = { providerPaymentId: attempt.providerPaymentId, amountMinor: 4500, currency: 'USD', status: 'SUCCEEDED' };
      const signature = createHmac('sha256', process.env.FAIRSCALE_BILLING_WEBHOOK_SECRET ?? 'test-fairscale-webhook-secret').update(JSON.stringify(payload)).digest('hex');
      await expect(provider.receiveWebhook('TEST', 'initial-period-event', signature, payload)).resolves.toMatchObject({ accepted: true, duplicate: false });
    } finally {
      vi.useRealTimers();
    }

    const subscription = await prisma.subscription.findFirstOrThrow({ where: { organizationId: organization.id, planVersionId: plan.id } });
    expect(subscription.endsAt).toEqual(new Date('2026-02-28T00:00:00.000Z'));
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

  it('requires verified payment before applying a scheduled plan change', async () => {
    const fixture = await createTerm('scheduled-plan-change', new Date('2026-01-01T00:00:00.000Z'), new Date('2026-02-01T00:00:00.000Z'));
    const change = await prisma.billingScheduledChange.create({ data: { id: crypto.randomUUID(), organizationId: fixture.organizationId, subscriptionTermId: fixture.id, idempotencyKey: 'scheduled-plan-change-1', kind: 'PLAN_CHANGE', status: 'PENDING', effectiveAt: fixture.currentPeriodEnd, targetPlanCode: 'ENTERPRISE', targetBillingPeriod: 'MONTHLY', targetStateJson: {} } });

    await expect(lifecycle.renewDueTerms(fixture.currentPeriodEnd, 100, 'TEST')).resolves.toMatchObject({ invoicesIssued: 0, paymentAttemptsCreated: 0 });
    await expect(prisma.billingSubscriptionTerm.findUniqueOrThrow({ where: { id: fixture.id } })).resolves.toMatchObject({ planCode: 'BUSINESS', status: 'ACTIVE' });
    const pendingChange = await prisma.billingScheduledChange.findUniqueOrThrow({ where: { id: change.id } });
    expect(pendingChange.status).toBe('PENDING');
    expect(typeof pendingChange.billingInvoiceId).toBe('string');

    const attempt = await prisma.billingPaymentAttempt.findFirstOrThrow({ where: { invoiceId: { not: null }, subscriptionTermId: fixture.id }, orderBy: { createdAt: 'desc' } });
    const payload = { providerPaymentId: attempt.providerPaymentId, amountMinor: Number(attempt.amountMinor), currency: 'USD', status: 'SUCCEEDED' };
    const signature = createHmac('sha256', process.env.FAIRSCALE_BILLING_WEBHOOK_SECRET ?? 'test-fairscale-webhook-secret').update(JSON.stringify(payload)).digest('hex');
    await expect(provider.receiveWebhook('TEST', 'scheduled-plan-change-payment', signature, payload)).resolves.toMatchObject({ accepted: true, duplicate: false });
    await expect(lifecycle.renewDueTerms(fixture.currentPeriodEnd, 100, 'TEST')).resolves.toMatchObject({ invoicesIssued: 0, paymentAttemptsCreated: 0 });

    await expect(prisma.billingSubscriptionTerm.findUniqueOrThrow({ where: { id: fixture.id } })).resolves.toMatchObject({ planCode: 'ENTERPRISE', billingPeriod: 'MONTHLY', status: 'ACTIVE' });
    const appliedChange = await prisma.billingScheduledChange.findUniqueOrThrow({ where: { id: change.id } });
    expect(appliedChange.status).toBe('APPLIED');
    expect(appliedChange.appliedAt).toBeInstanceOf(Date);
  });

  it('requires verified payment before adding paid establishment capacity', async () => {
    const fixture = await createTerm('scheduled-addon-change', new Date('2026-01-01T00:00:00.000Z'), new Date('2026-02-01T00:00:00.000Z'));
    const change = await prisma.billingScheduledChange.create({ data: { id: crypto.randomUUID(), organizationId: fixture.organizationId, subscriptionTermId: fixture.id, idempotencyKey: 'scheduled-addon-change-1', kind: 'ADDON_CHANGE', status: 'PENDING', effectiveAt: fixture.currentPeriodEnd, targetStateJson: { addonCode: 'ESTABLISHMENT', addonQuantity: 2 } } });

    await expect(lifecycle.renewDueTerms(fixture.currentPeriodEnd, 100, 'TEST')).resolves.toMatchObject({ invoicesIssued: 0, paymentAttemptsCreated: 0 });
    const pendingChange = await prisma.billingScheduledChange.findUniqueOrThrow({ where: { id: change.id } });
    expect(pendingChange.status).toBe('PENDING');
    expect(typeof pendingChange.billingInvoiceId).toBe('string');
    await expect(prisma.billingSubscriptionAddon.count({ where: { subscriptionTermId: fixture.id, status: 'ACTIVE' } })).resolves.toBe(0);

    const attempt = await prisma.billingPaymentAttempt.findFirstOrThrow({ where: { invoiceId: { not: null }, subscriptionTermId: fixture.id }, orderBy: { createdAt: 'desc' } });
    const payload = { providerPaymentId: attempt.providerPaymentId, amountMinor: Number(attempt.amountMinor), currency: 'USD', status: 'SUCCEEDED' };
    const signature = createHmac('sha256', process.env.FAIRSCALE_BILLING_WEBHOOK_SECRET ?? 'test-fairscale-webhook-secret').update(JSON.stringify(payload)).digest('hex');
    await expect(provider.receiveWebhook('TEST', 'scheduled-addon-change-payment', signature, payload)).resolves.toMatchObject({ accepted: true, duplicate: false });
    await expect(lifecycle.renewDueTerms(fixture.currentPeriodEnd, 100, 'TEST')).resolves.toMatchObject({ invoicesIssued: 0, paymentAttemptsCreated: 0 });
    await expect(prisma.billingSubscriptionAddon.findFirstOrThrow({ where: { subscriptionTermId: fixture.id, status: 'ACTIVE' } })).resolves.toMatchObject({ code: 'ESTABLISHMENT', quantity: 2, unitAmountMinor: 1000n });
    await expect(prisma.billingSubscriptionTerm.findUniqueOrThrow({ where: { id: fixture.id } })).resolves.toMatchObject({ addonAmountMinor: 2000n, totalAmountMinor: 6500n });
  });

  async function createTerm(handle: string, currentPeriodStart: Date, currentPeriodEnd: Date) {
    const organization = await prisma.organization.create({ data: { id: crypto.randomUUID(), businessTypeCode: 'COMMERCE_DISTRIBUTION', name: handle, handle, defaultCurrency: 'EUR' } });
    const customer = await prisma.billingCustomer.create({ data: { id: crypto.randomUUID(), identityKey: `test:${handle}`, displayName: handle, status: 'VERIFIED', verifiedAt: new Date(), organizations: { create: { organizationId: organization.id, role: 'OWNER' } } } });
    const plan = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'BUSINESS', version: 1 } } });
    const subscription = await prisma.subscription.create({ data: { id: crypto.randomUUID(), organizationId: organization.id, planVersionId: plan.id, status: 'ACTIVE', startsAt: new Date('2025-12-01T00:00:00.000Z'), endsAt: currentPeriodEnd } });
    await prisma.billingPromotionEligibility.create({ data: { id: crypto.randomUUID(), billingCustomerId: customer.id, promotionCode: 'WELCOME_MONTHLY15', firstEligibleAt: currentPeriodStart } });
    const term = await prisma.billingSubscriptionTerm.create({ data: { id: crypto.randomUUID(), billingCustomerId: customer.id, organizationId: organization.id, subscriptionId: subscription.id, status: 'ACTIVE', planCode: 'BUSINESS', billingPeriod: 'MONTHLY', currency: 'USD', catalogVersion: 1, baseAmountMinor: 4500n, discountAmountMinor: 0n, addonAmountMinor: 0n, totalAmountMinor: 4500n, startsAt: currentPeriodStart, currentPeriodStart, currentPeriodEnd, nextRenewalAt: currentPeriodEnd } });
    return { ...term, billingCustomerId: customer.id };
  }
});
