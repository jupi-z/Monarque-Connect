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

describe('Sales orders', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken = '';
  let scopedToken = '';
  let otherToken = '';
  let organizationId = '';
  let primaryEstablishmentId = '';
  let secondaryEstablishmentId = '';
  let partyId = '';
  let itemId = '';

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
    process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = connectionString; process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-test'; process.env.JWT_AUDIENCE = 'monarque-connect-api-test'; process.env.JWT_KEY_ID = 'phase5-orders-test';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey); process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); app.useGlobalFilters(new ProblemDetailsFilter()); await app.init();
    prisma = app.get(PrismaService);
    await prisma.paymentRecord.deleteMany(); await prisma.invoiceLine.deleteMany(); await prisma.invoice.deleteMany(); await prisma.salesOrderLine.deleteMany(); await prisma.salesOrder.deleteMany(); await prisma.quoteLine.deleteMany(); await prisma.quote.deleteMany();
    await prisma.opportunity.deleteMany(); await prisma.lead.deleteMany(); await prisma.warehouse.deleteMany(); await prisma.item.deleteMany(); await prisma.businessParty.deleteMany(); await prisma.auditEvent.deleteMany(); await prisma.membershipEstablishmentScope.deleteMany(); await prisma.invitationEstablishmentScope.deleteMany(); await prisma.invitation.deleteMany(); await prisma.membership.deleteMany(); await prisma.establishment.deleteMany(); await prisma.organization.deleteMany(); await prisma.refreshSession.deleteMany(); await prisma.user.deleteMany(); await prisma.loginRateLimitBucket.deleteMany(); await prisma.eventConsumerReceipt.deleteMany(); await prisma.outboxEvent.deleteMany(); await seedReferenceData(prisma);

    const suffix = Date.now();
    const ownerRegistration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email: `phase5-order-owner-${suffix}@example.com`, password: 'correct horse battery staple', firstName: 'Sales', lastName: 'Owner' }).expect(201);
    const ownerLogin = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(ownerRegistration).email, password: 'correct horse battery staple' }).expect(200); ownerToken = bodyOf<{ accessToken: string }>(ownerLogin).accessToken;
    const organization = await request(serverOf(app)).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({ businessTypeCode: 'SERVICE_PROVIDER', name: 'Phase 5 Order Tenant', handle: `phase5-order-${suffix}`, defaultCurrency: 'EUR', establishmentName: 'Main office' }).expect(201);
    const createdOrganization = bodyOf<{ id: string; establishment: { id: string } }>(organization); organizationId = createdOrganization.id; primaryEstablishmentId = createdOrganization.establishment.id;
    const operationsVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'OPERATIONS', version: 1 } } }); await prisma.subscription.updateMany({ where: { organizationId }, data: { planVersionId: operationsVersion.id } });
    const secondary = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/establishments`).set('Authorization', `Bearer ${ownerToken}`).send({ code: 'SECOND', name: 'Secondary office', type: 'BRANCH' }).expect(201); secondaryEstablishmentId = bodyOf<{ id: string }>(secondary).id;
    const party = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/parties`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'CUSTOMER', displayName: 'Acme Client' }).expect(201); partyId = bodyOf<{ id: string }>(party).id;
    const item = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'PRODUCT', sku: 'SKU-ORDER-1', name: 'Order package', description: 'Order catalog description', unit: 'HOUR', referencePrice: '25.0000', currency: 'EUR', trackInventory: false }).expect(201); itemId = bodyOf<{ id: string }>(item).id;
    const scopedRegistration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email: `phase5-order-scoped-${suffix}@example.com`, password: 'correct horse battery staple', firstName: 'Sales', lastName: 'Scoped' }).expect(201);
    const scopedLogin = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(scopedRegistration).email, password: 'correct horse battery staple' }).expect(200); scopedToken = bodyOf<{ accessToken: string }>(scopedLogin).accessToken;
    const scopedUser = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: `phase5-order-scoped-${suffix}@example.com` } }); const membershipId = randomUUID();
    await prisma.membership.create({ data: { id: membershipId, organizationId, userId: scopedUser.id, role: 'SALES', scopeMode: 'SELECTED_ESTABLISHMENTS' } }); await prisma.membershipEstablishmentScope.create({ data: { membershipId, organizationId, establishmentId: primaryEstablishmentId } });
    const otherRegistration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email: `phase5-order-other-${suffix}@example.com`, password: 'correct horse battery staple', firstName: 'Other', lastName: 'Owner' }).expect(201);
    const otherLogin = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(otherRegistration).email, password: 'correct horse battery staple' }).expect(200); otherToken = bodyOf<{ accessToken: string }>(otherLogin).accessToken;
  });

  afterAll(async () => { if (app) await app.close(); });

  it('converts an accepted quote once, preserves snapshots, and writes atomic audit/outbox records', async () => {
    const quoteId = await createAcceptedQuote('order-conversion-quote');
    const first = await convertQuote(quoteId, 'order-conversion-1');
    const order = bodyOf<{ id: string; sourceQuoteId: string; number: string; status: string; totalGross: string; lines: Array<Record<string, string>> }>(first);
    expect(order).toMatchObject({ organizationId, establishmentId: primaryEstablishmentId, sourceQuoteId: quoteId, status: 'DRAFT', totalGross: '30.0000' });
    expect(order.number).toMatch(new RegExp(`^SO-${new Date().getUTCFullYear()}-\\d{6}$`));
    expect(order.lines[0]).toMatchObject({ itemId, descriptionSnapshot: 'Order catalog description', skuSnapshot: 'SKU-ORDER-1', unitSnapshot: 'HOUR' });
    const repeated = await convertQuote(quoteId, 'order-conversion-2'); expect(bodyOf<{ id: string }>(repeated).id).toBe(order.id);
    await expect(prisma.salesOrder.count({ where: { organizationId, sourceQuoteId: quoteId } })).resolves.toBe(1);
    await expect(prisma.auditEvent.findFirst({ where: { targetType: 'SalesOrder', targetId: order.id, action: 'ORDER_CREATED' } })).resolves.not.toBeNull();
    await expect(prisma.outboxEvent.findFirst({ where: { aggregateType: 'SalesOrder', aggregateId: order.id, eventType: 'sales.order.created' } })).resolves.not.toBeNull();
  });

  it('serializes concurrent quote conversion and rejects idempotency-key reuse across orders', async () => {
    const quoteId = await createAcceptedQuote('order-race-quote');
    const responses = await Promise.all([convertQuote(quoteId, 'order-race-a'), convertQuote(quoteId, 'order-race-b')]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 201]);
    const secondQuoteId = await createAcceptedQuote('order-race-quote-2');
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/orders`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'order-reused-key').send(orderBody()).expect(201);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/orders`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'order-reused-key').send({ ...orderBody(), establishmentId: secondaryEstablishmentId }).expect(409);
    expect(secondQuoteId).toEqual(expect.any(String));
  });

  it('supports direct draft orders, confirms or cancels them, and freezes terminal orders', async () => {
    const created = await createDraftOrder('order-direct-1'); const orderId = bodyOf<{ id: string }>(created).id;
    await request(serverOf(app)).patch(`/api/v1/organizations/${organizationId}/orders/${orderId}`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'order-update-1').send({ lines: [{ itemId, descriptionSnapshot: 'Updated', unitSnapshot: 'EA', quantity: '2', unitPrice: '10', taxMode: 'EXCLUSIVE' }] }).expect(200);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/orders/${orderId}/confirm`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'order-confirm-1').expect(200);
    await request(serverOf(app)).patch(`/api/v1/organizations/${organizationId}/orders/${orderId}`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'order-update-after-confirm').send({ lines: [{ itemId, descriptionSnapshot: 'Forbidden', unitSnapshot: 'EA', quantity: '1', unitPrice: '1', taxMode: 'EXCLUSIVE' }] }).expect(409);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/orders/${orderId}/cancel`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'order-cancel-after-confirm').expect(409);
    const cancelled = await createDraftOrder('order-direct-cancel'); const cancelledId = bodyOf<{ id: string }>(cancelled).id;
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/orders/${cancelledId}/cancel`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'order-cancel-1').expect(200);
  });

  it('enforces tenant, entitlement and selected-establishment scope', async () => {
    await request(serverOf(app)).get(`/api/v1/organizations/${organizationId}/orders`).set('Authorization', `Bearer ${otherToken}`).expect(403);
    const scoped = await createDraftOrder('order-scoped', scopedToken); expect(bodyOf<{ establishmentId: string }>(scoped).establishmentId).toBe(primaryEstablishmentId);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/orders`).set('Authorization', `Bearer ${scopedToken}`).set('Idempotency-Key', 'order-secondary-scope').send(orderBody(secondaryEstablishmentId)).expect(403);
  });

  async function createAcceptedQuote(key: string): Promise<string> {
    const quote = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/quotes`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', key).send({ establishmentId: primaryEstablishmentId, partyId, validUntil: '2027-12-31', currency: 'EUR', lines: [{ itemId, descriptionSnapshot: 'Client description', unitSnapshot: 'CLIENT', quantity: '1', unitPrice: '25', taxMode: 'EXCLUSIVE', taxRate: '20' }] }).expect(201);
    const quoteId = bodyOf<{ id: string }>(quote).id;
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/quotes/${quoteId}/send`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `${key}-send`).expect(200);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/quotes/${quoteId}/accept`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', `${key}-accept`).expect(200);
    return quoteId;
  }

  async function convertQuote(quoteId: string, key: string): Promise<Response> { return request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/quotes/${quoteId}/convert-to-order`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', key); }
  async function createDraftOrder(key: string, token = ownerToken, establishmentId = primaryEstablishmentId): Promise<Response> { return request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/orders`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', key).send(orderBody(establishmentId)).expect(201); }
  function orderBody(establishmentId = primaryEstablishmentId): Record<string, unknown> { return { establishmentId, partyId, currency: 'EUR', lines: [{ itemId, descriptionSnapshot: 'Client description', unitSnapshot: 'CLIENT', quantity: '1', unitPrice: '25', taxMode: 'EXCLUSIVE', taxRate: '20' }] }; }
});

function bodyOf<T>(response: Response): T { return response.body as T; }
function serverOf(application: INestApplication): Parameters<typeof request>[0] { return application.getHttpServer() as Parameters<typeof request>[0]; }
