import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPair, randomUUID } from 'node:crypto';
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

describe('Sales invoices', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken = '';
  let otherToken = '';
  let organizationId = '';
  let establishmentId = '';
  let partyId = '';
  let itemId = '';

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
    process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = connectionString; process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-test'; process.env.JWT_AUDIENCE = 'monarque-connect-api-test'; process.env.JWT_KEY_ID = 'phase5-invoices-test';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey); process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); app.useGlobalFilters(new ProblemDetailsFilter()); await app.init();
    prisma = app.get(PrismaService);
    await prisma.paymentRecord.deleteMany(); await prisma.invoiceLine.deleteMany(); await prisma.invoice.deleteMany(); await prisma.salesOrderLine.deleteMany(); await prisma.salesOrder.deleteMany(); await prisma.quoteLine.deleteMany(); await prisma.quote.deleteMany();
    await prisma.opportunity.deleteMany(); await prisma.lead.deleteMany(); await prisma.warehouse.deleteMany(); await prisma.item.deleteMany(); await prisma.businessParty.deleteMany(); await prisma.auditEvent.deleteMany(); await prisma.membershipEstablishmentScope.deleteMany(); await prisma.invitationEstablishmentScope.deleteMany(); await prisma.invitation.deleteMany(); await prisma.membership.deleteMany(); await prisma.establishment.deleteMany(); await prisma.organization.deleteMany(); await prisma.refreshSession.deleteMany(); await prisma.user.deleteMany(); await prisma.loginRateLimitBucket.deleteMany(); await prisma.eventConsumerReceipt.deleteMany(); await prisma.outboxEvent.deleteMany(); await seedReferenceData(prisma);

    const suffix = Date.now();
    const ownerRegistration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email: `phase5-invoice-owner-${suffix}@example.com`, password: 'correct horse battery staple', firstName: 'Invoice', lastName: 'Owner' }).expect(201);
    const ownerLogin = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(ownerRegistration).email, password: 'correct horse battery staple' }).expect(200); ownerToken = bodyOf<{ accessToken: string }>(ownerLogin).accessToken;
    const organization = await request(serverOf(app)).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({ businessTypeCode: 'SERVICE_PROVIDER', name: 'Phase 5 Invoice Tenant', handle: `phase5-invoice-${suffix}`, defaultCurrency: 'EUR', establishmentName: 'Main office' }).expect(201);
    const createdOrganization = bodyOf<{ id: string; establishment: { id: string } }>(organization); organizationId = createdOrganization.id; establishmentId = createdOrganization.establishment.id;
    const operationsVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'OPERATIONS', version: 1 } } }); await prisma.subscription.updateMany({ where: { organizationId }, data: { planVersionId: operationsVersion.id } });
    const party = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/parties`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'CUSTOMER', displayName: 'Acme Client' }).expect(201); partyId = bodyOf<{ id: string }>(party).id;
    const item = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'PRODUCT', sku: 'SKU-INVOICE-1', name: 'Invoice package', description: 'Invoice catalog description', unit: 'EA', referencePrice: '25.0000', currency: 'EUR', trackInventory: false }).expect(201); itemId = bodyOf<{ id: string }>(item).id;
    const otherRegistration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email: `phase5-invoice-other-${suffix}@example.com`, password: 'correct horse battery staple', firstName: 'Other', lastName: 'Tenant' }).expect(201);
    const otherLogin = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(otherRegistration).email, password: 'correct horse battery staple' }).expect(200); otherToken = bodyOf<{ accessToken: string }>(otherLogin).accessToken;
  });

  afterAll(async () => { if (app) await app.close(); });

  it('converts a confirmed order once, preserves snapshots, and writes atomic audit/outbox records', async () => {
    const orderId = await createConfirmedOrder('invoice-conversion');
    const responses = await Promise.all([convertOrder(orderId, 'invoice-conversion-a'), convertOrder(orderId, 'invoice-conversion-b')]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 201]);
    const invoice = bodyOf<{ id: string; sourceOrderId: string; number: string; status: string; totalGross: string; lines: Array<Record<string, string>> }>(responses[0]);
    expect(invoice).toMatchObject({ organizationId, establishmentId, sourceOrderId: orderId, status: 'DRAFT', totalGross: '30.0000' });
    expect(invoice.number).toMatch(new RegExp(`^INV-${new Date().getUTCFullYear()}-\\d{6}$`));
    expect(invoice.lines[0]).toMatchObject({ itemId, descriptionSnapshot: 'Invoice catalog description', skuSnapshot: 'SKU-INVOICE-1', unitSnapshot: 'EA' });
    const repeated = await convertOrder(orderId, 'invoice-conversion-c'); expect(bodyOf<{ id: string }>(repeated).id).toBe(invoice.id);
    await expect(prisma.invoice.count({ where: { organizationId, sourceOrderId: orderId } })).resolves.toBe(1);
    await expect(prisma.auditEvent.findFirst({ where: { targetType: 'Invoice', targetId: invoice.id, action: 'INVOICE_CREATED' } })).resolves.not.toBeNull();
    await expect(prisma.outboxEvent.findFirst({ where: { aggregateType: 'Invoice', aggregateId: invoice.id, eventType: 'sales.invoice.created' } })).resolves.not.toBeNull();
  });

  it('requires confirmed orders, validates due dates, and freezes issued invoices', async () => {
    const draftOrder = await createDraftOrder('invoice-draft-source');
    await convertOrder(draftOrder, 'invoice-draft-conversion').expect(409);
    const orderId = await createConfirmedOrder('invoice-issue');
    const invoice = await convertOrder(orderId, 'invoice-issue-conversion').expect(201);
    const invoiceId = bodyOf<{ id: string }>(invoice).id;
    await request(serverOf(app)).patch(`/api/v1/organizations/${organizationId}/invoices/${invoiceId}`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'invoice-invalid-date').send({ dueAt: '2026-99-99' }).expect(400);
    const updated = await request(serverOf(app)).patch(`/api/v1/organizations/${organizationId}/invoices/${invoiceId}`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'invoice-due-date').send({ dueAt: '2026-12-31' }).expect(200);
    expect(bodyOf<{ dueAt: string }>(updated).dueAt).toBe('2026-12-31');
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/invoices/${invoiceId}/issue`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'invoice-issue-command').expect(200);
    await request(serverOf(app)).patch(`/api/v1/organizations/${organizationId}/invoices/${invoiceId}`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'invoice-after-issue').send({ dueAt: '2027-01-01' }).expect(409);
  });

  it('allows void before payment and refuses void after a valid payment', async () => {
    const voidableOrder = await createConfirmedOrder('invoice-voidable-order');
    const voidableInvoice = await convertOrder(voidableOrder, 'invoice-voidable-conversion').expect(201);
    const voidableId = bodyOf<{ id: string }>(voidableInvoice).id;
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/invoices/${voidableId}/issue`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'invoice-voidable-issue').expect(200);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/invoices/${voidableId}/void`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'invoice-voidable-void').expect(200);

    const paidOrder = await createConfirmedOrder('invoice-paid-order');
    const paidInvoice = await convertOrder(paidOrder, 'invoice-paid-conversion').expect(201);
    const paidId = bodyOf<{ id: string }>(paidInvoice).id;
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/invoices/${paidId}/issue`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'invoice-paid-issue').expect(200);
    await prisma.paymentRecord.create({ data: { id: randomUUID(), organizationId, establishmentId, invoiceId: paidId, amount: '1.0000', currency: 'EUR', methodCode: 'TEST', status: 'RECORDED' } });
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/invoices/${paidId}/void`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'invoice-paid-void').expect(409);
  });

  it('enforces tenant authorization on invoice reads', async () => {
    const orderId = await createConfirmedOrder('invoice-auth-order');
    const invoice = await convertOrder(orderId, 'invoice-auth-conversion').expect(201);
    const invoiceId = bodyOf<{ id: string }>(invoice).id;
    await request(serverOf(app)).get(`/api/v1/organizations/${organizationId}/invoices`).set('Authorization', `Bearer ${otherToken}`).expect(403);
    await request(serverOf(app)).get(`/api/v1/organizations/${organizationId}/invoices/${invoiceId}`).set('Authorization', `Bearer ${otherToken}`).expect(403);
  });

  async function createDraftOrder(key: string): Promise<string> {
    const response = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/orders`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', key).send(orderBody()).expect(201);
    return bodyOf<{ id: string }>(response).id;
  }

  async function createConfirmedOrder(key: string): Promise<string> {
    const orderId = await createDraftOrder(key);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/orders/${orderId}/confirm`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `${key}-confirm`).expect(200);
    return orderId;
  }

  function convertOrder(orderId: string, key: string) { return request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/orders/${orderId}/convert-to-invoice`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', key); }
  function orderBody(): Record<string, unknown> { return { establishmentId, partyId, currency: 'EUR', lines: [{ itemId, descriptionSnapshot: 'Client description', unitSnapshot: 'CLIENT', quantity: '1', unitPrice: '25', taxMode: 'EXCLUSIVE', taxRate: '20' }] }; }
});

function bodyOf<T>(response: Response): T { return response.body as T; }
function serverOf(application: INestApplication): Parameters<typeof request>[0] { return application.getHttpServer() as Parameters<typeof request>[0]; }
