import { createHmac, generateKeyPair, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportPKCS8, exportSPKI } from 'jose';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { ProblemDetailsFilter } from '../../src/http/problem-details.filter.js';
import { seedReferenceData } from '../../prisma/seed.js';

const generateKeyPairAsync = promisify(generateKeyPair);

describe('Phase 9.6 Billing HTTP flow', () => {
  let app: INestApplication;
  let ownerToken = '';
  let otherToken = '';
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
    organizationId = bodyOf<{ id: string }>(await request(server).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({ businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'Billing E2E tenant', handle: `billing-${randomUUID().slice(0, 8)}`, defaultCurrency: 'EUR', establishmentName: 'Head office' }).expect(201)).id;
  });

  afterAll(async () => { if (app) await app.close(); });

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
    const invoices = bodyOf<Array<{ status: string; amountPaidMinor: number }>>(await request(server).get(`/api/v1/organizations/${organizationId}/billing/invoices`).set('Authorization', `Bearer ${ownerToken}`).expect(200));
    expect(invoices).toMatchObject([{ status: 'PAID', amountPaidMinor: 3825 }]);
    await request(server).post('/api/v1/billing/providers/TEST/webhook').set('x-provider-event-id', 'phase96-e2e-provider-event-1').set('x-provider-signature', signature).send(payload).expect(202);
    const refundPayload = { ...payload, status: 'REFUNDED' };
    const refundSignature = createHmac('sha256', process.env.FAIRSCALE_BILLING_WEBHOOK_SECRET ?? 'test-fairscale-webhook-secret').update(JSON.stringify(refundPayload)).digest('hex');
    await request(server).post('/api/v1/billing/providers/TEST/webhook').set('x-provider-event-id', 'phase96-e2e-provider-event-refund').set('x-provider-signature', refundSignature).send(refundPayload).expect(202);
    const refundedSubscription = bodyOf<{ status: string }>(await request(server).get(`/api/v1/organizations/${organizationId}/billing/subscription`).set('Authorization', `Bearer ${ownerToken}`).expect(200));
    expect(refundedSubscription.status).toBe('SUSPENDED');
    const refundedInvoices = bodyOf<Array<{ status: string; amountPaidMinor: number }>>(await request(server).get(`/api/v1/organizations/${organizationId}/billing/invoices`).set('Authorization', `Bearer ${ownerToken}`).expect(200));
    expect(refundedInvoices).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'UNCOLLECTIBLE', amountPaidMinor: 0 })]));
    await request(server).get(`/api/v1/organizations/${organizationId}/billing/invoices`).set('Authorization', `Bearer ${otherToken}`).expect(403);
  });
});

async function registerAndLogin(server: Parameters<typeof request>[0], email: string): Promise<{ token: string }> {
  const password = 'correct horse battery staple';
  const registration = bodyOf<{ email: string }>(await request(server).post('/api/v1/auth/register').send({ email, password, firstName: 'FairScale', lastName: 'Test' }).expect(201));
  const login = bodyOf<{ accessToken: string }>(await request(server).post('/api/v1/auth/login').send({ identifier: registration.email, password }).expect(200));
  return { token: login.accessToken };
}

function bodyOf<T>(response: Response): T { return response.body as T; }
function serverOf(application: INestApplication): Parameters<typeof request>[0] { return application.getHttpServer() as Parameters<typeof request>[0]; }
