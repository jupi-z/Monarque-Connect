import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';
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

describe('Sales payments', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken = '';
  let organizationId = '';
  let establishmentId = '';
  let partyId = '';
  let itemId = '';

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
    process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = connectionString; process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-test'; process.env.JWT_AUDIENCE = 'monarque-connect-api-test'; process.env.JWT_KEY_ID = 'phase5-payments-test';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey); process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); app.useGlobalFilters(new ProblemDetailsFilter()); await app.init();
    prisma = app.get(PrismaService);
    await prisma.paymentRecord.deleteMany(); await prisma.invoiceLine.deleteMany(); await prisma.invoice.deleteMany(); await prisma.salesOrderLine.deleteMany(); await prisma.salesOrder.deleteMany(); await prisma.quoteLine.deleteMany(); await prisma.quote.deleteMany();
    await prisma.opportunity.deleteMany(); await prisma.lead.deleteMany(); await prisma.warehouse.deleteMany(); await prisma.item.deleteMany(); await prisma.businessParty.deleteMany(); await prisma.auditEvent.deleteMany(); await prisma.membershipEstablishmentScope.deleteMany(); await prisma.invitationEstablishmentScope.deleteMany(); await prisma.invitation.deleteMany(); await prisma.membership.deleteMany(); await prisma.establishment.deleteMany(); await prisma.organization.deleteMany(); await prisma.refreshSession.deleteMany(); await prisma.user.deleteMany(); await prisma.loginRateLimitBucket.deleteMany(); await prisma.eventConsumerReceipt.deleteMany(); await prisma.outboxEvent.deleteMany(); await seedReferenceData(prisma);

    const suffix = Date.now();
    const registration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email: `phase5-payment-owner-${suffix}@example.com`, password: 'correct horse battery staple', firstName: 'Payment', lastName: 'Owner' }).expect(201);
    const login = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(registration).email, password: 'correct horse battery staple' }).expect(200); ownerToken = bodyOf<{ accessToken: string }>(login).accessToken;
    const organization = await request(serverOf(app)).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({ businessTypeCode: 'SERVICE_PROVIDER', name: 'Phase 5 Payment Tenant', handle: `phase5-payment-${suffix}`, defaultCurrency: 'EUR', establishmentName: 'Main office' }).expect(201);
    const createdOrganization = bodyOf<{ id: string; establishment: { id: string } }>(organization); organizationId = createdOrganization.id; establishmentId = createdOrganization.establishment.id;
    const operationsVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'OPERATIONS', version: 1 } } }); await prisma.subscription.updateMany({ where: { organizationId }, data: { planVersionId: operationsVersion.id, startsAt: new Date('2020-01-01T00:00:00.000Z') } });
    const party = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/parties`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'CUSTOMER', displayName: 'Acme Client' }).expect(201); partyId = bodyOf<{ id: string }>(party).id;
    const item = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'PRODUCT', sku: 'SKU-PAYMENT-1', name: 'Payment package', description: 'Payment catalog description', unit: 'EA', referencePrice: '25.0000', currency: 'EUR', trackInventory: false }).expect(201); itemId = bodyOf<{ id: string }>(item).id;
  });

  afterAll(async () => { if (app) await app.close(); });

  it('records partial and exact payments, derives invoice status, and rejects overpayment', async () => {
    const invoiceId = await createIssuedInvoice('payment-balance');
    const partial = await recordPayment(invoiceId, 'payment-partial', '10.0000').expect(201);
    expect(bodyOf<{ amount: string; status: string; paidAt: string }>(partial)).toMatchObject({ amount: '10.0000', status: 'RECORDED' });
    const afterPartial = await getInvoice(invoiceId); expect(afterPartial).toMatchObject({ status: 'PARTIALLY_PAID', paidAmount: '10.0000', outstandingAmount: '20.0000' });
    const exact = await recordPayment(invoiceId, 'payment-exact', '20.0000').expect(201);
    expect(bodyOf<{ amount: string }>(exact).amount).toBe('20.0000');
    const afterExact = await getInvoice(invoiceId); expect(afterExact).toMatchObject({ status: 'PAID', paidAmount: '30.0000', outstandingAmount: '0.0000' });
    await recordPayment(invoiceId, 'payment-over', '0.0001').expect(409);
  });

  it('serializes concurrent payments and makes a key retry idempotent', async () => {
    const invoiceId = await createIssuedInvoice('payment-concurrency');
    const responses = await Promise.all([recordPayment(invoiceId, 'payment-race-a', '20.0000'), recordPayment(invoiceId, 'payment-race-b', '20.0000')]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const winner = responses.find((response) => response.status === 201);
    if (!winner) throw new Error('Expected one concurrent payment to succeed');
    const winnerKey = responses[0] === winner ? 'payment-race-a' : 'payment-race-b';
    const retry = await recordPayment(invoiceId, winnerKey, '20.0000').expect(201);
    expect(bodyOf<{ id: string }>(retry).id).toBe(bodyOf<{ id: string }>(winner).id);
  });

  it('rejects currency mismatch and reverses payments append-only', async () => {
    const invoiceId = await createIssuedInvoice('payment-reversal');
    await recordPayment(invoiceId, 'payment-currency', '1.0000', 'USD').expect(400);
    const payment = await recordPayment(invoiceId, 'payment-to-reverse', '10.0000').expect(201);
    const paymentId = bodyOf<{ id: string }>(payment).id;
    const reversed = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/payments/${paymentId}/reverse`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'payment-reversal-command').expect(200);
    expect(bodyOf<{ status: string; reversalOfId: string }>(reversed)).toMatchObject({ status: 'REVERSED', reversalOfId: paymentId });
    await expect(prisma.paymentRecord.count({ where: { invoiceId } })).resolves.toBe(2);
    await expect(getInvoice(invoiceId)).resolves.toMatchObject({ status: 'ISSUED', paidAmount: '0.0000', outstandingAmount: '30.0000' });
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/payments/${paymentId}/reverse`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'payment-reversal-command-2').expect(200);
  });

  it('refuses payments on void invoices and voiding invoices with valid payments', async () => {
    const voidedInvoiceId = await createIssuedInvoice('payment-voided');
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/invoices/${voidedInvoiceId}/void`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'payment-void-command').expect(200);
    await recordPayment(voidedInvoiceId, 'payment-after-void', '1.0000').expect(409);
    const paidInvoiceId = await createIssuedInvoice('payment-paid');
    await recordPayment(paidInvoiceId, 'payment-paid-record', '30.0000').expect(201);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/invoices/${paidInvoiceId}/void`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'payment-paid-void').expect(409);
  });

  async function createIssuedInvoice(key: string): Promise<string> {
    const order = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/orders`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `${key}-order`).send({ establishmentId, partyId, currency: 'EUR', lines: [{ itemId, descriptionSnapshot: 'Client description', unitSnapshot: 'CLIENT', quantity: '1', unitPrice: '25', taxMode: 'EXCLUSIVE', taxRate: '20' }] }).expect(201);
    const orderId = bodyOf<{ id: string }>(order).id;
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/orders/${orderId}/confirm`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `${key}-confirm`).expect(200);
    const invoice = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/orders/${orderId}/convert-to-invoice`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `${key}-invoice`).expect(201);
    const invoiceId = bodyOf<{ id: string }>(invoice).id;
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/invoices/${invoiceId}/issue`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `${key}-issue`).expect(200);
    return invoiceId;
  }

  function recordPayment(invoiceId: string, key: string, amount: string, currency = 'EUR') { return request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/invoices/${invoiceId}/payments`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', key).send({ amount, currency, methodCode: 'TEST', paidAt: '2026-10-13T12:00:00.000Z' }); }
  async function getInvoice(invoiceId: string): Promise<Record<string, unknown>> { const response = await request(serverOf(app)).get(`/api/v1/organizations/${organizationId}/invoices/${invoiceId}`).set('Authorization', `Bearer ${ownerToken}`).expect(200); return bodyOf<Record<string, unknown>>(response); }
});

function bodyOf<T>(response: Response): T { return response.body as T; }
function serverOf(application: INestApplication): Parameters<typeof request>[0] { return application.getHttpServer() as Parameters<typeof request>[0]; }
