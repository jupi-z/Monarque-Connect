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
const password = 'correct horse battery staple';

describe('Phase 6 Purchases E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let buyerToken = '';
  let otherToken = '';
  let scopedToken = '';
  let buyerOrganizationId = '';
  let buyerEstablishmentId = '';
  let secondaryEstablishmentId = '';
  let otherOrganizationId = '';
  let supplierPartyId = '';
  let primaryOrderId = '';

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_phase6_e2e';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = connectionString;
    process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-phase6-e2e';
    process.env.JWT_AUDIENCE = 'monarque-connect-api-phase6-e2e';
    process.env.JWT_KEY_ID = 'phase6-e2e';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey);
    process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    appRefValue = app;
    prisma = app.get(PrismaService);

    await cleanPurchasesData();
    await seedReferenceData(prisma);

    const suffix = Date.now();
    buyerToken = await registerAndLogin(`phase6-e2e-buyer-${suffix}@example.com`, 'Phase6 Buyer');
    const buyer = await createOrganization(buyerToken, 'phase6-e2e-buyer', 'MINING_SUPPLIER_B2B');
    buyerOrganizationId = buyer.id;
    buyerEstablishmentId = buyer.establishmentId;
    await upgradeToBusiness(buyerOrganizationId);
    secondaryEstablishmentId = bodyOf<{ id: string }>(await request(server()).post(`/api/v1/organizations/${buyerOrganizationId}/establishments`).set('Authorization', `Bearer ${buyerToken}`).send({ code: 'SECONDARY', name: 'Secondary office', type: 'BRANCH' }).expect(201)).id;

    const supplier = bodyOf<{ id: string }>(await request(server()).post(`/api/v1/organizations/${buyerOrganizationId}/parties`).set('Authorization', `Bearer ${buyerToken}`).send({ type: 'SUPPLIER', displayName: 'E2E Supplier', email: 'supplier@example.com' }).expect(201));
    supplierPartyId = supplier.id;

    otherToken = await registerAndLogin(`phase6-e2e-other-${suffix}@example.com`, 'Phase6 Other');
    const other = await createOrganization(otherToken, 'phase6-e2e-other', 'MINING_SUPPLIER_B2B');
    otherOrganizationId = other.id;
    await upgradeToBusiness(otherOrganizationId);

    scopedToken = await registerAndLogin(`phase6-e2e-scoped-${suffix}@example.com`, 'Phase6 Scoped');
    const scopedUser = await prisma.user.findUniqueOrThrow({ where: { normalizedEmail: `phase6-e2e-scoped-${suffix}@example.com` } });
    const membership = await prisma.membership.create({ data: { id: randomUUID(), organizationId: buyerOrganizationId, userId: scopedUser.id, role: 'OPERATIONS', scopeMode: 'SELECTED_ESTABLISHMENTS' } });
    await prisma.membershipEstablishmentScope.create({ data: { membershipId: membership.id, organizationId: buyerOrganizationId, establishmentId: secondaryEstablishmentId } });
  }, 60000);

  afterAll(async () => {
    if (!app) return;
    await cleanPurchasesData();
    await app.close();
  });

  it('executes RFQ to partial receipt and correction without Inventory side effects', async () => {
    const warehousesBefore = await prisma.warehouse.count({ where: { organizationId: buyerOrganizationId } });
    const itemsBefore = await prisma.item.count({ where: { organizationId: buyerOrganizationId } });

    const rfq = bodyOf<{ id: string; recipients: Array<{ id: string }>; lines: Array<{ id: string }> }>(await request(server()).post(`/api/v1/organizations/${buyerOrganizationId}/supplier-rfqs`).set('Authorization', `Bearer ${buyerToken}`).set('Idempotency-Key', 'phase6-e2e-rfq-create').send({ establishmentId: buyerEstablishmentId, title: 'E2E steel sourcing', currency: 'EUR', lines: [{ descriptionSnapshot: 'Steel coil', unitSnapshot: 'KG', quantity: '5' }], recipients: [{ localPartyId: supplierPartyId }] }).expect(201));
    const recipient = rfq.recipients[0];
    const rfqLine = rfq.lines[0];
    if (!recipient || !rfqLine) throw new Error('RFQ response is incomplete');

    await request(server()).post(`/api/v1/organizations/${buyerOrganizationId}/supplier-rfqs/${rfq.id}/send`).set('Authorization', `Bearer ${buyerToken}`).set('Idempotency-Key', 'phase6-e2e-rfq-send').expect(200);
    const order = bodyOf<{ id: string; lines: Array<{ id: string }>; status: string }>(await request(server()).post(`/api/v1/organizations/${buyerOrganizationId}/purchase-orders`).set('Authorization', `Bearer ${buyerToken}`).set('Idempotency-Key', 'phase6-e2e-order-create').send({ establishmentId: buyerEstablishmentId, sourceSupplierRfqId: rfq.id, sourceRecipientId: recipient.id, currency: 'EUR', lines: [{ sourceRfqLineId: rfqLine.id, descriptionSnapshot: 'ignored', unitSnapshot: 'ignored', quantity: '5', unitPrice: '10', taxMode: 'EXCLUSIVE', taxRate: '0' }] }).expect(201));
    const orderLine = order.lines[0];
    if (!orderLine) throw new Error('Purchase Order response is incomplete');
    primaryOrderId = order.id;
    expect(order.status).toBe('DRAFT');

    await request(server()).post(`/api/v1/organizations/${buyerOrganizationId}/purchase-orders/${order.id}/send`).set('Authorization', `Bearer ${buyerToken}`).set('Idempotency-Key', 'phase6-e2e-order-send').expect(200);
    await request(server()).post(`/api/v1/organizations/${buyerOrganizationId}/purchase-orders/${order.id}/confirm`).set('Authorization', `Bearer ${buyerToken}`).set('Idempotency-Key', 'phase6-e2e-order-confirm').expect(200);

    const receipt = bodyOf<{ id: string; lines: Array<{ id: string }>; status: string }>(await request(server()).post(`/api/v1/organizations/${buyerOrganizationId}/purchase-orders/${order.id}/receipts`).set('Authorization', `Bearer ${buyerToken}`).set('Idempotency-Key', 'phase6-e2e-receipt-create').send({ receivedAt: '2026-10-13T12:00:00.000Z', reference: 'GR-E2E-1', lines: [{ purchaseOrderLineId: orderLine.id, quantity: '2' }] }).expect(201));
    const receiptLine = receipt.lines[0];
    if (!receiptLine) throw new Error('Goods Receipt response is incomplete');
    await request(server()).post(`/api/v1/organizations/${buyerOrganizationId}/purchase-orders/${order.id}/receipts/${receipt.id}/confirm`).set('Authorization', `Bearer ${buyerToken}`).set('Idempotency-Key', 'phase6-e2e-receipt-confirm').expect(200);

    const corrected = bodyOf<{ status: string; lines: Array<{ cumulativeQuantity: string }>; corrections: Array<{ reason: string }> }>(await request(server()).post(`/api/v1/organizations/${buyerOrganizationId}/purchase-orders/${order.id}/receipts/${receipt.id}/correct`).set('Authorization', `Bearer ${buyerToken}`).set('Idempotency-Key', 'phase6-e2e-receipt-correct').send({ reason: 'E2E quantity adjustment', lines: [{ purchaseOrderLineId: orderLine.id, deltaQuantity: '-1' }] }).expect(200));
    expect(corrected).toMatchObject({ status: 'CONFIRMED' });
    expect(corrected.lines[0]?.cumulativeQuantity).toBe('1.000000');
    expect(corrected.corrections[0]?.reason).toBe('E2E quantity adjustment');

    const finalOrder = bodyOf<{ status: string }>(await request(server()).get(`/api/v1/organizations/${buyerOrganizationId}/purchase-orders/${order.id}`).set('Authorization', `Bearer ${buyerToken}`).expect(200));
    expect(finalOrder.status).toBe('PARTIALLY_RECEIVED');
    expect(await prisma.warehouse.count({ where: { organizationId: buyerOrganizationId } })).toBe(warehousesBefore);
    expect(await prisma.item.count({ where: { organizationId: buyerOrganizationId } })).toBe(itemsBefore);
    await expect(prisma.outboxEvent.count({ where: { organizationId: buyerOrganizationId, aggregateId: receipt.id, eventType: { in: ['purchases.goods_receipt.created.v1', 'purchases.goods_receipt.confirmed.v1', 'purchases.goods_receipt.corrected.v1'] } } })).resolves.toBe(3);
  });

  it('enforces tenant and selected-establishment isolation for Purchases', async () => {
    await request(server()).get(`/api/v1/organizations/${buyerOrganizationId}/purchase-orders`).set('Authorization', `Bearer ${otherToken}`).expect(403);
    await request(server()).get(`/api/v1/organizations/${buyerOrganizationId}/purchase-orders/${primaryOrderId}`).set('Authorization', `Bearer ${scopedToken}`).expect(403);

    const secondaryOrder = bodyOf<{ id: string }>(await request(server()).post(`/api/v1/organizations/${buyerOrganizationId}/purchase-orders`).set('Authorization', `Bearer ${buyerToken}`).set('Idempotency-Key', 'phase6-e2e-secondary-order').send({ establishmentId: secondaryEstablishmentId, supplierPartyId, currency: 'EUR', lines: [{ descriptionSnapshot: 'Secondary steel', unitSnapshot: 'KG', quantity: '1', unitPrice: '10', taxMode: 'EXCLUSIVE', taxRate: '0' }] }).expect(201));
    await request(server()).get(`/api/v1/organizations/${buyerOrganizationId}/purchase-orders/${secondaryOrder.id}`).set('Authorization', `Bearer ${scopedToken}`).expect(200);
    await request(server()).get(`/api/v1/organizations/${otherOrganizationId}/purchase-orders`).set('Authorization', `Bearer ${buyerToken}`).expect(403);
  });

  async function registerAndLogin(email: string, name: string): Promise<string> {
    const [firstName, lastName] = name.split(' ');
    const registration = await request(server()).post('/api/v1/auth/register').send({ email, password, firstName, lastName }).expect(201);
    const login = await request(server()).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(registration).email, password }).expect(200);
    return bodyOf<{ accessToken: string }>(login).accessToken;
  }

  async function createOrganization(token: string, slug: string, businessTypeCode: string): Promise<{ id: string; establishmentId: string }> {
    const response = await request(server()).post('/api/v1/organizations').set('Authorization', `Bearer ${token}`).send({ businessTypeCode, name: `Phase 6 ${slug}`, handle: `${slug}-${Date.now()}`, defaultCurrency: 'EUR', establishmentName: 'Main office' }).expect(201);
    const body = bodyOf<{ id: string; establishment: { id: string } }>(response);
    return { id: body.id, establishmentId: body.establishment.id };
  }

  async function upgradeToBusiness(organizationId: string): Promise<void> {
    const business = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'BUSINESS', version: 1 } }, select: { id: true } });
    await prisma.subscription.updateMany({ where: { organizationId }, data: { planVersionId: business.id } });
  }

  async function cleanPurchasesData(): Promise<void> {
    await prisma.goodsReceiptCorrectionLine.deleteMany();
    await prisma.goodsReceiptCorrection.deleteMany();
    await prisma.goodsReceiptLine.deleteMany();
    await prisma.goodsReceipt.deleteMany();
    await prisma.purchaseOrderLine.deleteMany();
    await prisma.purchaseOrder.deleteMany();
    await prisma.supplierRFQRecipient.deleteMany();
    await prisma.supplierRFQLine.deleteMany();
    await prisma.supplierRFQ.deleteMany();
  }
});

function bodyOf<T>(response: Response): T { return response.body as T; }
function server(): Parameters<typeof request>[0] { return appRefValue.getHttpServer() as Parameters<typeof request>[0]; }
let appRefValue!: INestApplication;
