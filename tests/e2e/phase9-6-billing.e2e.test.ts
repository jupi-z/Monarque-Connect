import { createHmac, generateKeyPair, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportPKCS8, exportSPKI } from 'jose';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { BillingLifecycleService } from '../../src/billing/billing-lifecycle.service.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { ProblemDetailsFilter } from '../../src/http/problem-details.filter.js';
import { seedReferenceData } from '../../prisma/seed.js';

const generateKeyPairAsync = promisify(generateKeyPair);

describe('Phase 9.6 Billing HTTP flow', () => {
  let app: INestApplication;
  let ownerToken = '';
  let otherToken = '';
  let platformAdminToken = '';
  let organizationId = '';

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
    process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = connectionString; process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-phase96'; process.env.JWT_AUDIENCE = 'monarque-connect-phase96-api'; process.env.JWT_KEY_ID = 'phase96-e2e';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey); process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    const prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE billing_refunds, billing_payments, billing_payment_attempts, billing_invoices, billing_scheduled_changes, billing_subscription_addons, billing_subscription_terms, billing_checkout_orders, billing_quotes, billing_promotion_redemptions, billing_promotion_eligibilities, billing_customer_organizations, billing_customers, outbox_events, event_consumer_receipts, refresh_sessions, login_rate_limit_buckets, organization_module_activations, organization_entitlements, organization_quota_usages, quota_reservations, quota_ledgers, memberships, establishments, subscriptions, audit_events, organizations, users RESTART IDENTITY CASCADE`);
    await seedReferenceData(prisma);
    const server = serverOf(app);
    ownerToken = (await registerAndLogin(server, 'phase96-billing-owner@example.test')).token;
    otherToken = (await registerAndLogin(server, 'phase96-billing-other@example.test')).token;
    const platformAdmin = await registerAndLogin(server, 'phase96-billing-platform@example.test');
    platformAdminToken = platformAdmin.token;
    const platformAdminUser = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: platformAdmin.email } });
    app.get(ConfigService).set('PLATFORM_ADMIN_USER_IDS', [platformAdminUser.id]);
    organizationId = bodyOf<{ id: string }>(await request(server).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({ businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'Billing E2E tenant', handle: `billing-${randomUUID().slice(0, 8)}`, defaultCurrency: 'EUR', establishmentName: 'Head office' }).expect(201)).id;
  });

  afterAll(async () => { if (app) await app.close(); });

  async function createZamurekBillingTerm() {
    const prisma = app.get(PrismaService);
    const organization = bodyOf<{ id: string }>(await request(serverOf(app)).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({ businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'ZAMUREK Billing isolation tenant', handle: `zamurek-billing-${randomUUID().slice(0, 8)}`, defaultCurrency: 'EUR', establishmentName: 'Head office' }).expect(201));
    const planCode = `ZAMUREK_BILLING_${randomUUID().slice(0, 8).toUpperCase()}`;
    await prisma.plan.create({ data: { code: planCode, name: 'ZAMUREK billing fixture', productCode: 'ZAMUREK' } });
    const planVersion = await prisma.planVersion.create({ data: { id: randomUUID(), productCode: 'ZAMUREK', planCode, version: 1, status: 'ACTIVE', currency: 'USD', billingPeriod: 'MONTHLY' } });
    const customer = await prisma.billingCustomer.create({ data: { id: randomUUID(), identityKey: `zamurek-billing-test:${randomUUID()}`, displayName: 'ZAMUREK test customer' } });
    const startsAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const endsAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    const subscription = await prisma.subscription.create({ data: { id: randomUUID(), organizationId: organization.id, productCode: 'ZAMUREK', planVersionId: planVersion.id, status: 'ACTIVE', startsAt, endsAt } });
    const term = await prisma.billingSubscriptionTerm.create({ data: { id: randomUUID(), billingCustomerId: customer.id, organizationId: organization.id, productCode: 'ZAMUREK', subscriptionId: subscription.id, status: 'ACTIVE', planCode, billingPeriod: 'MONTHLY', currency: 'USD', catalogVersion: 1, baseAmountMinor: 700n, discountAmountMinor: 0n, addonAmountMinor: 0n, totalAmountMinor: 700n, startsAt, currentPeriodStart: startsAt, currentPeriodEnd: endsAt, nextRenewalAt: endsAt } });
    return { prisma, term, subscription, organizationId: organization.id };
  }

  it('does not activate a plan until a signed payment event is verified', async () => {
    const server = serverOf(app);
    const quote = bodyOf<{ id: string; totalAmountMinor: number }>(await request(server).post(`/api/v1/organizations/${organizationId}/billing/quotes`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'phase96-e2e-quote-1').send({ planCode: 'BUSINESS', billingPeriod: 'MONTHLY', activeEstablishmentCount: 3 }).expect(201));
    expect(quote.totalAmountMinor).toBe(3825);
    const order = bodyOf<{ id: string; status: string }>(await request(server).post(`/api/v1/organizations/${organizationId}/billing/checkout-orders`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'phase96-e2e-order-1').send({ quoteId: quote.id }).expect(201));
    expect(order.status).toBe('CREATED');
    const attempt = bodyOf<{ providerPaymentId: string; status: string; amountMinor: number }>(await request(server).post(`/api/v1/organizations/${organizationId}/billing/checkout-orders/${order.id}/payment-attempts`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'phase96-e2e-attempt-1').send({ provider: 'TEST' }).expect(201));
    expect(attempt.status).toBe('REQUIRES_ACTION');
    await request(server).get(`/api/v1/organizations/${organizationId}/billing/subscription`).set('Authorization', `Bearer ${ownerToken}`).expect(404);

    const payload = { providerPaymentId: attempt.providerPaymentId, amountMinor: attempt.amountMinor, currency: 'USD', status: 'SUCCEEDED' };
    const signature = createHmac('sha256', process.env.FAIRSCALE_BILLING_WEBHOOK_SECRET ?? 'test-fairscale-webhook-secret').update(JSON.stringify(payload)).digest('hex');
    await request(server).post('/api/v1/billing/providers/TEST/webhook').set('x-provider-event-id', 'phase96-e2e-provider-event-1').set('x-provider-signature', signature).send(payload).expect(202);
    const subscription = bodyOf<{ planCode: string; status: string; totalAmountMinor: number }>(await request(server).get(`/api/v1/organizations/${organizationId}/billing/subscription`).set('Authorization', `Bearer ${ownerToken}`).expect(200));
    expect(subscription).toMatchObject({ planCode: 'BUSINESS', status: 'ACTIVE', totalAmountMinor: 3825 });
    const invoices = bodyOf<Array<{ id: string; status: string; amountPaidMinor: number }>>(await request(server).get(`/api/v1/organizations/${organizationId}/billing/invoices`).set('Authorization', `Bearer ${ownerToken}`).expect(200));
    expect(invoices).toMatchObject([{ status: 'PAID', amountPaidMinor: 3825 }]);
    const invoice = await request(server).get(`/api/v1/organizations/${organizationId}/billing/invoices/${invoices[0]!.id}`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(invoice.body).toMatchObject({ id: invoices[0]!.id, status: 'PAID' });
    await request(server).post('/api/v1/billing/providers/TEST/webhook').set('x-provider-event-id', 'phase96-e2e-provider-event-1').set('x-provider-signature', signature).send(payload).expect(202);
    const refundPayload = { ...payload, status: 'REFUNDED' };
    const refundSignature = createHmac('sha256', process.env.FAIRSCALE_BILLING_WEBHOOK_SECRET ?? 'test-fairscale-webhook-secret').update(JSON.stringify(refundPayload)).digest('hex');
    await request(server).post('/api/v1/billing/providers/TEST/webhook').set('x-provider-event-id', 'phase96-e2e-provider-event-refund').set('x-provider-signature', refundSignature).send(refundPayload).expect(202);
    const refundedSubscription = bodyOf<{ status: string }>(await request(server).get(`/api/v1/organizations/${organizationId}/billing/subscription`).set('Authorization', `Bearer ${ownerToken}`).expect(200));
    expect(refundedSubscription.status).toBe('SUSPENDED');
    const refundedInvoices = bodyOf<Array<{ status: string; amountPaidMinor: number }>>(await request(server).get(`/api/v1/organizations/${organizationId}/billing/invoices`).set('Authorization', `Bearer ${ownerToken}`).expect(200));
    expect(refundedInvoices).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'UNCOLLECTIBLE', amountPaidMinor: 0 })]));
    await request(server).get(`/api/v1/organizations/${organizationId}/billing/invoices`).set('Authorization', `Bearer ${otherToken}`).expect(403);
    await request(server).get(`/api/v1/organizations/${organizationId}/billing/invoices/${invoices[0]!.id}`).set('Authorization', `Bearer ${otherToken}`).expect(403);
  });

  it('activates purchased establishment addons on initial payment and carries them into renewal', async () => {
    const server = serverOf(app);
    const prisma = app.get(PrismaService);
    const lifecycle = app.get(BillingLifecycleService);
    const organization = bodyOf<{ id: string }>(await request(server).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({ businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'Initial addon tenant', handle: `billing-addon-${randomUUID().slice(0, 8)}`, defaultCurrency: 'EUR', establishmentName: 'Head office' }).expect(201));

    const quote = bodyOf<{ id: string; totalAmountMinor: number }>(await request(server).post(`/api/v1/organizations/${organization.id}/billing/quotes`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'phase96-initial-addon-quote').send({ planCode: 'BUSINESS', billingPeriod: 'MONTHLY', activeEstablishmentCount: 5 }).expect(201));
    expect(quote.totalAmountMinor).toBe(5825);
    const order = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organization.id}/billing/checkout-orders`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'phase96-initial-addon-order').send({ quoteId: quote.id }).expect(201));
    const attempt = bodyOf<{ providerPaymentId: string; amountMinor: number }>(await request(server).post(`/api/v1/organizations/${organization.id}/billing/checkout-orders/${order.id}/payment-attempts`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'phase96-initial-addon-attempt').send({ provider: 'TEST' }).expect(201));
    const payload = { providerPaymentId: attempt.providerPaymentId, amountMinor: attempt.amountMinor, currency: 'USD', status: 'SUCCEEDED' };
    const signature = createHmac('sha256', process.env.FAIRSCALE_BILLING_WEBHOOK_SECRET ?? 'test-fairscale-webhook-secret').update(JSON.stringify(payload)).digest('hex');
    await request(server).post('/api/v1/billing/providers/TEST/webhook').set('x-provider-event-id', 'phase96-initial-addon-payment').set('x-provider-signature', signature).send(payload).expect(202);
    const customer = await prisma.billingCustomer.findFirstOrThrow({ where: { organizations: { some: { organizationId: organization.id } } } });
    await request(server).put(`/api/v1/platform/billing/customers/${customer.id}/verification`).set('Authorization', `Bearer ${platformAdminToken}`).set('Idempotency-Key', 'phase96-initial-addon-verification').send({ status: 'VERIFIED', reason: 'E2E verified commercial identity' }).expect(200);

    const capacity = bodyOf<{ includedEstablishments: number; addonEstablishments: number; effectiveEstablishments: number }>(await request(server).get(`/api/v1/organizations/${organization.id}/billing/capacity`).set('Authorization', `Bearer ${ownerToken}`).expect(200));
    expect(capacity).toMatchObject({ includedEstablishments: 3, addonEstablishments: 2, effectiveEstablishments: 5 });
    const term = await prisma.billingSubscriptionTerm.findFirstOrThrow({ where: { organizationId: organization.id } });
    await expect(prisma.billingSubscriptionAddon.findMany({ where: { subscriptionTermId: term.id, status: 'ACTIVE' } })).resolves.toEqual([expect.objectContaining({ code: 'ESTABLISHMENT', quantity: 2, unitAmountMinor: 1000n })]);

    await prisma.billingSubscriptionTerm.update({ where: { id: term.id }, data: { currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'), currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'), nextRenewalAt: new Date('2026-02-01T00:00:00.000Z') } });
    await prisma.billingSubscriptionAddon.updateMany({ where: { subscriptionTermId: term.id }, data: { startsAt: new Date('2026-01-01T00:00:00.000Z') } });
    await expect(lifecycle.renewDueTerms(new Date('2026-02-01T00:00:00.000Z'), 100, 'TEST')).resolves.toMatchObject({ invoicesIssued: 1, paymentAttemptsCreated: 1 });
    const renewalAttempt = await prisma.billingPaymentAttempt.findFirstOrThrow({ where: { subscriptionTermId: term.id, invoiceId: { not: null }, status: 'REQUIRES_ACTION' }, orderBy: { createdAt: 'desc' } });
    const renewalPayload = { providerPaymentId: renewalAttempt.providerPaymentId, amountMinor: Number(renewalAttempt.amountMinor), currency: 'USD', status: 'SUCCEEDED' };
    const renewalSignature = createHmac('sha256', process.env.FAIRSCALE_BILLING_WEBHOOK_SECRET ?? 'test-fairscale-webhook-secret').update(JSON.stringify(renewalPayload)).digest('hex');
    await request(server).post('/api/v1/billing/providers/TEST/webhook').set('x-provider-event-id', 'phase96-initial-addon-renewal').set('x-provider-signature', renewalSignature).send(renewalPayload).expect(202);
    const renewalInvoice = await prisma.billingInvoice.findUniqueOrThrow({ where: { id: renewalAttempt.invoiceId! }, include: { lines: true } });
    expect(renewalInvoice).toMatchObject({ status: 'PAID', totalMinor: 5825n });
    expect(renewalInvoice.lines).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ADDON', totalMinor: 2000n })]));
  });

  it('allows a Connect checkout when the organization already has a Billing term for another product', async () => {
    const server = serverOf(app);
    const prisma = app.get(PrismaService);
    const organization = bodyOf<{ id: string }>(await request(server).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({ businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'Cross-product billing tenant', handle: `billing-products-${randomUUID().slice(0, 8)}`, defaultCurrency: 'EUR', establishmentName: 'Head office' }).expect(201));

    const quote = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organization.id}/billing/quotes`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'phase96-cross-product-quote').send({ planCode: 'BUSINESS', billingPeriod: 'MONTHLY', activeEstablishmentCount: 3 }).expect(201));
    const quoteRecord = await prisma.billingQuote.findUniqueOrThrow({ where: { id: quote.id } });
    const order = bodyOf<{ id: string }>(await request(server).post(`/api/v1/organizations/${organization.id}/billing/checkout-orders`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'phase96-cross-product-order').send({ quoteId: quote.id }).expect(201));
    const attempt = bodyOf<{ providerPaymentId: string; amountMinor: number }>(await request(server).post(`/api/v1/organizations/${organization.id}/billing/checkout-orders/${order.id}/payment-attempts`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'phase96-cross-product-attempt').send({ provider: 'TEST' }).expect(201));

    const zamurekPlanCode = `ZAMUREK_BILLING_${randomUUID().slice(0, 8).toUpperCase()}`;
    await prisma.plan.create({ data: { code: zamurekPlanCode, name: 'ZAMUREK billing fixture', productCode: 'ZAMUREK' } });
    const zamurekPlanVersion = await prisma.planVersion.create({ data: { id: randomUUID(), productCode: 'ZAMUREK', planCode: zamurekPlanCode, version: 1, status: 'ACTIVE', currency: 'USD', billingPeriod: 'MONTHLY' } });
    const startsAt = new Date();
    const endsAt = new Date(startsAt);
    endsAt.setUTCMonth(endsAt.getUTCMonth() + 1);
    const zamurekSubscription = await prisma.subscription.create({ data: { id: randomUUID(), organizationId: organization.id, productCode: 'ZAMUREK', planVersionId: zamurekPlanVersion.id, status: 'ACTIVE', startsAt, endsAt } });
    await prisma.billingSubscriptionTerm.create({ data: { id: randomUUID(), billingCustomerId: quoteRecord.billingCustomerId, organizationId: organization.id, productCode: 'ZAMUREK', subscriptionId: zamurekSubscription.id, status: 'ACTIVE', planCode: zamurekPlanCode, billingPeriod: 'MONTHLY', currency: 'USD', catalogVersion: 1, baseAmountMinor: 700n, discountAmountMinor: 0n, addonAmountMinor: 0n, totalAmountMinor: 700n, startsAt, currentPeriodStart: startsAt, currentPeriodEnd: endsAt, nextRenewalAt: endsAt } });

    const payload = { providerPaymentId: attempt.providerPaymentId, amountMinor: attempt.amountMinor, currency: 'USD', status: 'SUCCEEDED' };
    const signature = createHmac('sha256', process.env.FAIRSCALE_BILLING_WEBHOOK_SECRET ?? 'test-fairscale-webhook-secret').update(JSON.stringify(payload)).digest('hex');
    await request(server).post('/api/v1/billing/providers/TEST/webhook').set('x-provider-event-id', 'phase96-cross-product-connect-payment').set('x-provider-signature', signature).send(payload).expect(202);

    await expect(prisma.billingSubscriptionTerm.findMany({ where: { organizationId: organization.id }, orderBy: { productCode: 'asc' }, select: { productCode: true, status: true } })).resolves.toEqual([
      { productCode: 'MONARQUE_CONNECT', status: 'ACTIVE' },
      { productCode: 'ZAMUREK', status: 'ACTIVE' },
    ]);
  });

  it('keeps another product invoices out of Connect billing reads', async () => {
    const { prisma, term, organizationId: zamurekOrganizationId } = await createZamurekBillingTerm();
    const now = new Date();
    const invoice = await prisma.billingInvoice.create({ data: { id: randomUUID(), billingCustomerId: term.billingCustomerId, organizationId, subscriptionTermId: term.id, number: `ZM-${randomUUID()}`, sequence: 1, status: 'OPEN', currency: 'USD', periodStart: term.currentPeriodStart, periodEnd: term.currentPeriodEnd, subtotalMinor: 700n, discountMinor: 0n, totalMinor: 700n, amountPaidMinor: 0n, dueAt: now } });

    const listed = bodyOf<Array<{ id: string }>>(await request(serverOf(app)).get(`/api/v1/organizations/${zamurekOrganizationId}/billing/invoices`).set('Authorization', `Bearer ${ownerToken}`).expect(200));
    expect(listed.some((item) => item.id === invoice.id)).toBe(false);
    await request(serverOf(app)).get(`/api/v1/organizations/${zamurekOrganizationId}/billing/invoices/${invoice.id}`).set('Authorization', `Bearer ${ownerToken}`).expect(404);
  });

  it('does not apply another product scheduled billing changes in the Connect lifecycle job', async () => {
    const { prisma, term, subscription } = await createZamurekBillingTerm();
    const change = await prisma.billingScheduledChange.create({ data: { id: randomUUID(), subscriptionTermId: term.id, organizationId, idempotencyKey: `zamurek-cancel-${randomUUID()}`, kind: 'CANCELLATION', status: 'PENDING', effectiveAt: new Date(Date.now() - 60_000) } });

    await app.get(BillingLifecycleService).applyScheduledChanges(new Date(), 500);

    await expect(prisma.billingScheduledChange.findUnique({ where: { id: change.id } })).resolves.toMatchObject({ status: 'PENDING' });
    await expect(prisma.billingSubscriptionTerm.findUnique({ where: { id: term.id } })).resolves.toMatchObject({ status: 'ACTIVE' });
    await expect(prisma.subscription.findUnique({ where: { id: subscription.id } })).resolves.toMatchObject({ status: 'ACTIVE' });
  });

  it('does not let Connect cancel or replay another product scheduled change', async () => {
    const { prisma, term, organizationId: zamurekOrganizationId } = await createZamurekBillingTerm();
    const idempotencyKey = `zamurek-scheduled-${randomUUID()}`;
    const change = await prisma.billingScheduledChange.create({ data: { id: randomUUID(), subscriptionTermId: term.id, organizationId, idempotencyKey, kind: 'CANCELLATION', status: 'PENDING', effectiveAt: term.currentPeriodEnd } });
    const server = serverOf(app);

    await request(server).post(`/api/v1/organizations/${zamurekOrganizationId}/billing/subscription/changes/${change.id}/cancel`).set('Authorization', `Bearer ${ownerToken}`).expect(404);
    await request(server).post(`/api/v1/organizations/${zamurekOrganizationId}/billing/subscription/${term.id}/changes`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', idempotencyKey).send({ kind: 'CANCELLATION' }).expect(409);

    await expect(prisma.billingScheduledChange.findUnique({ where: { id: change.id } })).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('does not apply Connect dunning to another product invoice', async () => {
    const { prisma, term, subscription } = await createZamurekBillingTerm();
    const dueAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const invoice = await prisma.billingInvoice.create({ data: { id: randomUUID(), billingCustomerId: term.billingCustomerId, organizationId, subscriptionTermId: term.id, number: `ZM-${randomUUID()}`, sequence: 1, status: 'OPEN', currency: 'USD', periodStart: term.currentPeriodStart, periodEnd: term.currentPeriodEnd, subtotalMinor: 700n, discountMinor: 0n, totalMinor: 700n, amountPaidMinor: 0n, dueAt } });

    await app.get(BillingLifecycleService).runDunning(new Date(), 500);

    await expect(prisma.billingInvoice.findUnique({ where: { id: invoice.id } })).resolves.toMatchObject({ status: 'OPEN' });
    await expect(prisma.billingSubscriptionTerm.findUnique({ where: { id: term.id } })).resolves.toMatchObject({ status: 'ACTIVE' });
    await expect(prisma.subscription.findUnique({ where: { id: subscription.id } })).resolves.toMatchObject({ status: 'ACTIVE' });
  });

  it('publishes a versioned price only through the platform admin surface', async () => {
    const server = serverOf(app);
    const input = { planCode: 'BUSINESS', billingPeriod: 'YEARLY', currency: 'USD', baseAmountMinor: 4600, welcomeAmountMinor: 3910, annualDiscountAmountMinor: 0, includedEstablishments: 3, addonAmountMinor: 1100, addonCapacityUnits: 1 };
    const published = bodyOf<{ version: number; baseAmountMinor: number }>(await request(server).post('/api/v1/platform/billing/prices').set('Authorization', `Bearer ${platformAdminToken}`).set('Idempotency-Key', 'phase96-admin-price-1').send(input).expect(201));
    expect(published).toMatchObject({ version: 2, baseAmountMinor: 4600 });
    await request(server).post('/api/v1/platform/billing/prices').set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'phase96-admin-price-2').send(input).expect(403);
    await request(server).post('/api/v1/platform/billing/prices').set('Authorization', `Bearer ${platformAdminToken}`).set('Idempotency-Key', 'phase96-admin-price-1').send(input).expect(201);
  });
});

async function registerAndLogin(server: Parameters<typeof request>[0], email: string): Promise<{ token: string; email: string }> {
  const password = 'correct horse battery staple';
  const registration = bodyOf<{ email: string }>(await request(server).post('/api/v1/auth/register').send({ email, password, firstName: 'FairScale', lastName: 'Test' }).expect(201));
  const login = bodyOf<{ accessToken: string }>(await request(server).post('/api/v1/auth/login').send({ identifier: registration.email, password }).expect(200));
  return { token: login.accessToken, email: registration.email };
}

function bodyOf<T>(response: Response): T { return response.body as T; }
function serverOf(application: INestApplication): Parameters<typeof request>[0] { return application.getHttpServer() as Parameters<typeof request>[0]; }
