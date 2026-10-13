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
const password = 'correct horse battery staple';

describe('Phase 6 Supplier RFQs', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let buyerToken = '';
  let supplierToken = '';
  let buyerOrganizationId = '';
  let buyerEstablishmentId = '';
  let supplierOrganizationId = '';
  let localPartyId = '';

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_phase6_task3';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = connectionString;
    process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-phase6-rfq-test';
    process.env.JWT_AUDIENCE = 'monarque-connect-api-phase6-rfq-test';
    process.env.JWT_KEY_ID = 'phase6-rfq-test';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey);
    process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.goodsReceiptCorrectionLine.deleteMany();
    await prisma.goodsReceiptCorrection.deleteMany();
    await prisma.goodsReceiptLine.deleteMany();
    await prisma.goodsReceipt.deleteMany();
    await prisma.purchaseOrderLine.deleteMany();
    await prisma.purchaseOrder.deleteMany();
    await prisma.supplierRFQRecipient.deleteMany();
    await prisma.supplierRFQLine.deleteMany();
    await prisma.supplierRFQ.deleteMany();
    await prisma.connectionRequest.deleteMany();
    await prisma.organizationNetworkTrust.deleteMany();
    await prisma.organizationNetworkProfile.deleteMany();
    await prisma.paymentRecord.deleteMany();
    await prisma.invoiceLine.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.salesOrderLine.deleteMany();
    await prisma.salesOrder.deleteMany();
    await prisma.quoteLine.deleteMany();
    await prisma.quote.deleteMany();
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

    const buyer = await createUser(app, 'phase6-rfq-buyer');
    const supplier = await createUser(app, 'phase6-rfq-supplier');
    buyerToken = buyer.token;
    supplierToken = supplier.token;
    const buyerOrganization = await createOrganization(app, buyerToken, 'phase6-rfq-buyer', 'MINING_SUPPLIER_B2B');
    buyerOrganizationId = buyerOrganization.id;
    buyerEstablishmentId = buyerOrganization.establishmentId;
    const supplierOrganization = await createOrganization(app, supplierToken, 'phase6-rfq-supplier', 'MINING_SUPPLIER_B2B');
    supplierOrganizationId = supplierOrganization.id;
    const businessVersion = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'BUSINESS', version: 1 } }, select: { id: true } });
    await prisma.subscription.updateMany({ where: { organizationId: { in: [buyerOrganizationId, supplierOrganizationId] } }, data: { planVersionId: businessVersion.id } });
    await request(serverOf(app)).patch(`/api/v1/organizations/${supplierOrganizationId}/network-profile`).set('Authorization', `Bearer ${supplierToken}`).send({ isPublic: true, displayName: 'Public supplier', categories: ['supplier'], publishedItemIds: [] }).expect(200);
    const connection = await request(serverOf(app)).post(`/api/v1/organizations/${buyerOrganizationId}/connection-requests`).set('Authorization', `Bearer ${buyerToken}`).send({ targetOrganizationId: supplierOrganizationId }).expect(201);
    await request(serverOf(app)).patch(`/api/v1/organizations/${supplierOrganizationId}/connection-requests/${bodyOf<{ id: string }>(connection).id}`).set('Authorization', `Bearer ${supplierToken}`).send({ status: 'ACCEPTED' }).expect(200);
    const party = await request(serverOf(app)).post(`/api/v1/organizations/${buyerOrganizationId}/parties`).set('Authorization', `Bearer ${buyerToken}`).send({ type: 'SUPPLIER', displayName: 'Local supplier', email: 'local@example.com' }).expect(201);
    localPartyId = bodyOf<{ id: string }>(party).id;
  }, 60000);

  afterAll(async () => {
    if (!app) return;
    await prisma.goodsReceiptCorrectionLine.deleteMany();
    await prisma.goodsReceiptCorrection.deleteMany();
    await prisma.goodsReceiptLine.deleteMany();
    await prisma.goodsReceipt.deleteMany();
    await prisma.purchaseOrderLine.deleteMany();
    await prisma.purchaseOrder.deleteMany();
    await prisma.supplierRFQRecipient.deleteMany();
    await prisma.supplierRFQLine.deleteMany();
    await prisma.supplierRFQ.deleteMany();
    await app.close();
  });

  it('creates a tenant-scoped RFQ with isolated local and Network recipient snapshots', async () => {
    const response = await request(serverOf(app)).post(`/api/v1/organizations/${buyerOrganizationId}/supplier-rfqs`).set('Authorization', `Bearer ${buyerToken}`).set('Idempotency-Key', 'rfq-create-1').send({ title: 'Steel sourcing', establishmentId: buyerEstablishmentId, neededBy: '2026-11-30', currency: 'EUR', lines: [{ descriptionSnapshot: 'Steel coil', unitSnapshot: 'KG', quantity: '100.500000' }], recipients: [{ localPartyId }, { networkOrganizationId: supplierOrganizationId }] }).expect(201);
    const responseBody = bodyOf<{ organizationId: string; establishmentId: string; number: string; status: string; title: string; recipients: Array<Record<string, unknown>>; lines: Array<Record<string, unknown>> }>(response);
    expect(responseBody).toMatchObject({ organizationId: buyerOrganizationId, establishmentId: buyerEstablishmentId, status: 'DRAFT', title: 'Steel sourcing' });
    expect(responseBody.number).toMatch(/^RFQ-/);
    expect(responseBody.recipients).toEqual(expect.arrayContaining([expect.objectContaining({ localPartyId, supplierKind: 'LOCAL_PARTY', status: 'PENDING' }), expect.objectContaining({ networkOrganizationId: supplierOrganizationId, supplierKind: 'NETWORK_ORGANIZATION', status: 'PENDING' })]));
    expect(responseBody.recipients[0]).not.toHaveProperty('email');
    expect(responseBody.recipients[0]).not.toHaveProperty('phone');
    expect(responseBody.lines[0]).toMatchObject({ quantity: '100.500000', descriptionSnapshot: 'Steel coil' });
    await expect(prisma.auditEvent.count({ where: { action: 'SUPPLIER_RFQ_CREATED', organizationId: buyerOrganizationId } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { eventType: 'purchases.supplier_rfq.created.v1', organizationId: buyerOrganizationId } })).resolves.toBe(1);
    await request(serverOf(app)).post(`/api/v1/organizations/${buyerOrganizationId}/supplier-rfqs`).set('Authorization', `Bearer ${buyerToken}`).set('Idempotency-Key', 'rfq-create-1').send({ title: 'Different payload', establishmentId: buyerEstablishmentId, currency: 'EUR', lines: [{ descriptionSnapshot: 'Steel coil', unitSnapshot: 'KG', quantity: '101' }], recipients: [{ localPartyId }] }).expect(409);
  });

  it('enforces recipient validation, buyer scope and cross-tenant isolation', async () => {
    await request(serverOf(app)).post(`/api/v1/organizations/${buyerOrganizationId}/supplier-rfqs`).set('Authorization', `Bearer ${buyerToken}`).set('Idempotency-Key', 'rfq-self').send({ title: 'Invalid', establishmentId: buyerEstablishmentId, currency: 'EUR', lines: [{ descriptionSnapshot: 'x', unitSnapshot: 'EA', quantity: '1' }], recipients: [{ networkOrganizationId: buyerOrganizationId }] }).expect(409);
    await request(serverOf(app)).get(`/api/v1/organizations/${buyerOrganizationId}/supplier-rfqs`).set('Authorization', `Bearer ${supplierToken}`).expect(403);
    const listed = await request(serverOf(app)).get(`/api/v1/organizations/${buyerOrganizationId}/supplier-rfqs`).set('Authorization', `Bearer ${buyerToken}`).expect(200);
    expect(bodyOf<{ items: unknown[] }>(listed).items).toHaveLength(1);
  });

  it('sends recipients exactly once, supports draft update, and enforces terminal transitions', async () => {
    const created = await request(serverOf(app)).post(`/api/v1/organizations/${buyerOrganizationId}/supplier-rfqs`).set('Authorization', `Bearer ${buyerToken}`).set('Idempotency-Key', 'rfq-create-2').send({ title: 'Copper sourcing', establishmentId: buyerEstablishmentId, currency: 'EUR', lines: [{ descriptionSnapshot: 'Copper', unitSnapshot: 'KG', quantity: '12' }], recipients: [{ localPartyId }] }).expect(201);
    const id = bodyOf<{ id: string }>(created).id;
    await request(serverOf(app)).patch(`/api/v1/organizations/${buyerOrganizationId}/supplier-rfqs/${id}`).set('Authorization', `Bearer ${buyerToken}`).set('Idempotency-Key', 'rfq-update-2').send({ neededBy: '2026-12-15' }).expect(200);
    await request(serverOf(app)).post(`/api/v1/organizations/${buyerOrganizationId}/supplier-rfqs/${id}/send`).set('Authorization', `Bearer ${buyerToken}`).set('Idempotency-Key', 'rfq-send-2').expect(200);
    await request(serverOf(app)).post(`/api/v1/organizations/${buyerOrganizationId}/supplier-rfqs/${id}/send`).set('Authorization', `Bearer ${buyerToken}`).set('Idempotency-Key', 'rfq-send-2').expect(200);
    await request(serverOf(app)).patch(`/api/v1/organizations/${buyerOrganizationId}/supplier-rfqs/${id}`).set('Authorization', `Bearer ${buyerToken}`).set('Idempotency-Key', 'rfq-update-after-send').send({ neededBy: '2027-01-01' }).expect(409);
    await request(serverOf(app)).post(`/api/v1/organizations/${buyerOrganizationId}/supplier-rfqs/${id}/close`).set('Authorization', `Bearer ${buyerToken}`).set('Idempotency-Key', 'rfq-close-2').expect(200);
    await request(serverOf(app)).post(`/api/v1/organizations/${buyerOrganizationId}/supplier-rfqs/${id}/cancel`).set('Authorization', `Bearer ${buyerToken}`).set('Idempotency-Key', 'rfq-cancel-after-close').expect(409);
    await expect(prisma.outboxEvent.count({ where: { eventType: 'purchases.supplier_rfq.recipient_sent.v1', aggregateId: id } })).resolves.toBe(1);
  });

  it('revalidates recipient eligibility when a draft is sent', async () => {
    const created = await request(serverOf(app)).post(`/api/v1/organizations/${buyerOrganizationId}/supplier-rfqs`).set('Authorization', `Bearer ${buyerToken}`).set('Idempotency-Key', 'rfq-revalidation').send({ title: 'Revalidation', establishmentId: buyerEstablishmentId, currency: 'EUR', lines: [{ descriptionSnapshot: 'Copper', unitSnapshot: 'KG', quantity: '1' }], recipients: [{ localPartyId }] }).expect(201);
    const id = bodyOf<{ id: string }>(created).id;
    await request(serverOf(app)).post(`/api/v1/organizations/${buyerOrganizationId}/parties/${localPartyId}/deactivate`).set('Authorization', `Bearer ${buyerToken}`).expect(200);
    await request(serverOf(app)).post(`/api/v1/organizations/${buyerOrganizationId}/supplier-rfqs/${id}/send`).set('Authorization', `Bearer ${buyerToken}`).set('Idempotency-Key', 'rfq-revalidation-send').expect(409);
    await request(serverOf(app)).post(`/api/v1/organizations/${buyerOrganizationId}/parties/${localPartyId}/reactivate`).set('Authorization', `Bearer ${buyerToken}`).expect(200);
  });
});

async function createUser(app: INestApplication, slug: string): Promise<{ token: string }> {
  const email = `${slug}-${Date.now()}@example.com`;
  const registration = await request(serverOf(app)).post('/api/v1/auth/register').send({ email, password, firstName: slug, lastName: 'Owner' }).expect(201);
  const login = await request(serverOf(app)).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(registration).email, password }).expect(200);
  return { token: bodyOf<{ accessToken: string }>(login).accessToken };
}

async function createOrganization(app: INestApplication, token: string, slug: string, businessTypeCode: string): Promise<{ id: string; establishmentId: string }> {
  const response = await request(serverOf(app)).post('/api/v1/organizations').set('Authorization', `Bearer ${token}`).send({ businessTypeCode, name: `Phase 6 ${slug}`, handle: `${slug}-${Date.now()}`, defaultCurrency: 'EUR', establishmentName: 'Main office' }).expect(201);
  const body = bodyOf<{ id: string; establishment: { id: string } }>(response);
  return { id: body.id, establishmentId: body.establishment.id };
}

function bodyOf<T>(response: Response): T { return response.body as T; }
function serverOf(application: INestApplication): Parameters<typeof request>[0] { return application.getHttpServer() as Parameters<typeof request>[0]; }
