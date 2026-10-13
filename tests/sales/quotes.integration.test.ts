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

describe('Sales quotes', () => {
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
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = connectionString;
    process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-test';
    process.env.JWT_AUDIENCE = 'monarque-connect-api-test';
    process.env.JWT_KEY_ID = 'phase5-quotes-test';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey);
    process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.paymentRecord.deleteMany();
    await prisma.invoiceLine.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.salesOrderLine.deleteMany();
    await prisma.salesOrder.deleteMany();
    await prisma.quoteLine.deleteMany();
    await prisma.quote.deleteMany();
    await prisma.opportunity.deleteMany();
    await prisma.lead.deleteMany();
    await prisma.warehouse.deleteMany();
    await prisma.item.deleteMany();
    await prisma.businessParty.deleteMany();
    await prisma.auditEvent.deleteMany();
    await prisma.membershipEstablishmentScope.deleteMany();
    await prisma.invitationEstablishmentScope.deleteMany();
    await prisma.invitation.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.establishment.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.refreshSession.deleteMany();
    await prisma.user.deleteMany();
    await prisma.loginRateLimitBucket.deleteMany();
    await prisma.eventConsumerReceipt.deleteMany();
    await prisma.outboxEvent.deleteMany();
    await seedReferenceData(prisma);

    const suffix = Date.now();
    const ownerRegistration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email: `phase5-quote-owner-${suffix}@example.com`, password: 'correct horse battery staple', firstName: 'Sales', lastName: 'Owner' }).expect(201);
    const ownerLogin = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(ownerRegistration).email, password: 'correct horse battery staple' }).expect(200);
    ownerToken = bodyOf<{ accessToken: string }>(ownerLogin).accessToken;

    const organization = await request(serverOf(app)).post('/api/v1/organizations').set('Authorization', `Bearer ${ownerToken}`).send({ businessTypeCode: 'SERVICE_PROVIDER', name: 'Phase 5 Sales Tenant', handle: `phase5-sales-${suffix}`, defaultCurrency: 'EUR', establishmentName: 'Main office' }).expect(201);
    const createdOrganization = bodyOf<{ id: string; establishment: { id: string } }>(organization);
    organizationId = createdOrganization.id;
    primaryEstablishmentId = createdOrganization.establishment.id;
    const operationsVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'OPERATIONS', version: 1 } } });
    await prisma.subscription.updateMany({ where: { organizationId }, data: { planVersionId: operationsVersion.id } });

    const secondary = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/establishments`).set('Authorization', `Bearer ${ownerToken}`).send({ code: 'SECOND', name: 'Secondary office', type: 'BRANCH' }).expect(201);
    secondaryEstablishmentId = bodyOf<{ id: string }>(secondary).id;

    const party = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/parties`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'CUSTOMER', displayName: 'Acme Client' }).expect(201);
    partyId = bodyOf<{ id: string }>(party).id;
    const item = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${ownerToken}`).send({ type: 'PRODUCT', sku: 'SKU-QUOTE-1', name: 'Consulting package', description: 'Current catalog description', unit: 'HOUR', referencePrice: '15.0050', currency: 'EUR', trackInventory: false }).expect(201);
    itemId = bodyOf<{ id: string }>(item).id;

    const scopedRegistration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email: `phase5-quote-scoped-${suffix}@example.com`, password: 'correct horse battery staple', firstName: 'Sales', lastName: 'Scoped' }).expect(201);
    const scopedLogin = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(scopedRegistration).email, password: 'correct horse battery staple' }).expect(200);
    scopedToken = bodyOf<{ accessToken: string }>(scopedLogin).accessToken;
    const scopedUser = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: `phase5-quote-scoped-${suffix}@example.com` } });
    const membershipId = randomUUID();
    await prisma.membership.create({ data: { id: membershipId, organizationId, userId: scopedUser.id, role: 'SALES', scopeMode: 'SELECTED_ESTABLISHMENTS' } });
    await prisma.membershipEstablishmentScope.create({ data: { membershipId, organizationId, establishmentId: primaryEstablishmentId } });

    const otherRegistration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email: `phase5-quote-other-${suffix}@example.com`, password: 'correct horse battery staple', firstName: 'Other', lastName: 'Owner' }).expect(201);
    const otherLogin = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(otherRegistration).email, password: 'correct horse battery staple' }).expect(200);
    otherToken = bodyOf<{ accessToken: string }>(otherLogin).accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('creates a quote with server snapshots, money totals, audit and outbox atomically', async () => {
    const created = await createQuote('quote-create-1', ownerToken, { descriptionSnapshot: 'Client supplied text', unitSnapshot: 'CLIENT', quantity: '2', unitPrice: '15.0050', taxMode: 'EXCLUSIVE', taxRate: '20' });
    const quote = bodyOf<{ id: string; number: string; status: string; currency: string; totalNet: string; totalTax: string; totalGross: string; lines: Array<Record<string, string>> }>(created);
    expect(quote).toMatchObject({ organizationId, establishmentId: primaryEstablishmentId, number: `Q-${new Date().getUTCFullYear()}-000001`, status: 'DRAFT', currency: 'EUR', totalNet: '30.0100', totalTax: '6.0020', totalGross: '36.0120' });
    expect(quote.lines[0]).toMatchObject({ itemId, descriptionSnapshot: 'Current catalog description', skuSnapshot: 'SKU-QUOTE-1', unitSnapshot: 'HOUR' });
    await expect(prisma.auditEvent.findFirst({ where: { targetType: 'Quote', targetId: quote.id, action: 'QUOTE_CREATED' } })).resolves.not.toBeNull();
    await expect(prisma.outboxEvent.findFirst({ where: { aggregateType: 'Quote', aggregateId: quote.id, eventType: 'sales.quote.created' } })).resolves.not.toBeNull();
  });

  it('is idempotent for repeated create and send commands', async () => {
    const first = await createQuote('quote-idempotent-create', ownerToken);
    const quoteId = bodyOf<{ id: string }>(first).id;
    const repeated = await createQuote('quote-idempotent-create', ownerToken);
    expect(bodyOf<{ id: string }>(repeated).id).toBe(quoteId);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/quotes/${quoteId}/send`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'quote-idempotent-send').expect(200);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/quotes/${quoteId}/send`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'quote-idempotent-send').expect(200);
    await expect(prisma.auditEvent.count({ where: { targetType: 'Quote', targetId: quoteId, action: 'QUOTE_STATUS_CHANGED' } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { aggregateType: 'Quote', aggregateId: quoteId, eventType: 'sales.quote.status_changed' } })).resolves.toBe(1);
  });

  it('allows draft edits, enforces legal transitions and rejects terminal mutations', async () => {
    const quote = bodyOf<{ id: string }>(await createQuote('quote-transitions', ownerToken)).id;
    await request(serverOf(app)).patch(`/api/v1/organizations/${organizationId}/quotes/${quote}`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'quote-update-1').send({ validUntil: '2027-01-31' }).expect(200);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/quotes/${quote}/send`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'quote-send-1').expect(200);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/quotes/${quote}/accept`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'quote-accept-1').expect(200);
    await request(serverOf(app)).patch(`/api/v1/organizations/${organizationId}/quotes/${quote}`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'quote-update-after-accept').send({ validUntil: '2027-02-01' }).expect(409);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/quotes/${quote}/cancel`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'quote-cancel-after-accept').expect(409);

    const rejected = bodyOf<{ id: string }>(await createQuote('quote-rejected', ownerToken)).id;
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/quotes/${rejected}/send`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'quote-send-2').expect(200);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/quotes/${rejected}/reject`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'quote-reject-1').expect(200);

    const cancelled = bodyOf<{ id: string }>(await createQuote('quote-cancelled', ownerToken)).id;
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/quotes/${cancelled}/cancel`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'quote-cancel-1').expect(200);
  });

  it('enforces tenant, module and establishment scope, and rejects inactive references', async () => {
    await request(serverOf(app)).get(`/api/v1/organizations/${organizationId}/quotes`).set('Authorization', `Bearer ${otherToken}`).expect(403);
    const scopedQuote = await createQuote('quote-scoped', scopedToken);
    expect(bodyOf<{ establishmentId: string }>(scopedQuote).establishmentId).toBe(primaryEstablishmentId);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/quotes`).set('Authorization', `Bearer ${scopedToken}`).set('Idempotency-Key', 'quote-secondary-scope').send({ establishmentId: secondaryEstablishmentId, partyId, validUntil: '2027-01-31', currency: 'EUR', lines: [{ itemId, descriptionSnapshot: 'x', unitSnapshot: 'x', quantity: '1', unitPrice: '1', taxMode: 'EXCLUSIVE' }] }).expect(403);

    await prisma.businessParty.update({ where: { id: partyId }, data: { active: false } });
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/quotes`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'quote-inactive-party').send({ establishmentId: primaryEstablishmentId, partyId, validUntil: '2027-01-31', currency: 'EUR', lines: [{ itemId, descriptionSnapshot: 'x', unitSnapshot: 'x', quantity: '1', unitPrice: '1', taxMode: 'EXCLUSIVE' }] }).expect(404);
    await prisma.businessParty.update({ where: { id: partyId }, data: { active: true } });
    await prisma.item.update({ where: { id: itemId }, data: { active: false } });
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/quotes`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'quote-inactive-item').send({ establishmentId: primaryEstablishmentId, partyId, validUntil: '2027-01-31', currency: 'EUR', lines: [{ itemId, descriptionSnapshot: 'x', unitSnapshot: 'x', quantity: '1', unitPrice: '1', taxMode: 'EXCLUSIVE' }] }).expect(404);
    await prisma.item.update({ where: { id: itemId }, data: { active: true } });
  });

  it('rejects missing idempotency keys and prevents cross-tenant references', async () => {
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/quotes`).set('Authorization', `Bearer ${ownerToken}`).send({ establishmentId: primaryEstablishmentId, partyId, validUntil: '2027-01-31', currency: 'EUR', lines: [{ itemId, descriptionSnapshot: 'x', unitSnapshot: 'x', quantity: '1', unitPrice: '1', taxMode: 'EXCLUSIVE' }] }).expect(400);
    const foreignOrganization = await request(serverOf(app)).post('/api/v1/organizations').set('Authorization', `Bearer ${otherToken}`).send({ businessTypeCode: 'SERVICE_PROVIDER', name: 'Foreign Tenant', handle: `phase5-foreign-${Date.now()}`, defaultCurrency: 'EUR', establishmentName: 'Foreign office' }).expect(201);
    const foreign = bodyOf<{ id: string; establishment: { id: string } }>(foreignOrganization);
    await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/quotes`).set('Authorization', `Bearer ${ownerToken}`).set('Idempotency-Key', 'quote-foreign-reference').send({ establishmentId: foreign.establishment.id, partyId, validUntil: '2027-01-31', currency: 'EUR', lines: [{ itemId, descriptionSnapshot: 'x', unitSnapshot: 'x', quantity: '1', unitPrice: '1', taxMode: 'EXCLUSIVE' }] }).expect(403);
  });

  async function createQuote(key: string, token: string, lineOverrides: Record<string, string> = {}): Promise<Response> {
    const response = await request(serverOf(app)).post(`/api/v1/organizations/${organizationId}/quotes`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', key).send({ establishmentId: primaryEstablishmentId, partyId, validUntil: '2026-12-31', currency: 'EUR', lines: [{ itemId, descriptionSnapshot: 'Client description', unitSnapshot: 'CLIENT', quantity: '1', unitPrice: '10.0000', taxMode: 'EXCLUSIVE', ...lineOverrides }] });
    expect(response.status).toBe(201);
    return response;
  }
});

function bodyOf<T>(response: Response): T {
  return response.body as T;
}

function serverOf(application: INestApplication): Parameters<typeof request>[0] {
  const server: unknown = application.getHttpServer();
  return server as Parameters<typeof request>[0];
}
