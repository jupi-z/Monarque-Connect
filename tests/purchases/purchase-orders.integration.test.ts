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

describe('Phase 6 Purchase Orders', () => {
  let app: INestApplication; let prisma: PrismaService; let token = ''; let organizationId = ''; let establishmentId = ''; let partyId = '';
  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_phase6_task3_test'; process.env.CORS_ORIGINS = ''; process.env.JWT_ISSUER = 'phase6-po-test'; process.env.JWT_AUDIENCE = 'phase6-po-api'; process.env.JWT_KEY_ID = 'phase6-po'; process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey); process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile(); app = moduleRef.createNestApplication(); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); app.useGlobalFilters(new ProblemDetailsFilter()); await app.init(); appRefValue = app; prisma = app.get(PrismaService);
    await prisma.goodsReceiptCorrectionLine.deleteMany(); await prisma.goodsReceiptCorrection.deleteMany(); await prisma.goodsReceiptLine.deleteMany(); await prisma.goodsReceipt.deleteMany(); await prisma.purchaseOrderLine.deleteMany(); await prisma.purchaseOrder.deleteMany(); await prisma.supplierRFQRecipient.deleteMany(); await prisma.supplierRFQLine.deleteMany(); await prisma.supplierRFQ.deleteMany(); await prisma.paymentRecord.deleteMany(); await prisma.invoiceLine.deleteMany(); await prisma.invoice.deleteMany(); await prisma.salesOrderLine.deleteMany(); await prisma.salesOrder.deleteMany(); await prisma.quoteLine.deleteMany(); await prisma.quote.deleteMany(); await prisma.opportunity.deleteMany(); await prisma.lead.deleteMany(); await prisma.warehouse.deleteMany(); await prisma.connectionRequest.deleteMany(); await prisma.organizationNetworkProfile.deleteMany(); await prisma.businessParty.deleteMany(); await prisma.auditEvent.deleteMany(); await prisma.membershipEstablishmentScope.deleteMany(); await prisma.invitationEstablishmentScope.deleteMany(); await prisma.invitation.deleteMany(); await prisma.membership.deleteMany(); await prisma.establishment.deleteMany(); await prisma.organization.deleteMany(); await prisma.refreshSession.deleteMany(); await prisma.user.deleteMany(); await prisma.loginRateLimitBucket.deleteMany(); await prisma.eventConsumerReceipt.deleteMany(); await prisma.outboxEvent.deleteMany(); await seedReferenceData(prisma);
    const registration = await request(server()).post('/api/v1/auth/register').send({ email: `phase6-po-${Date.now()}@example.com`, password, firstName: 'Purchase', lastName: 'Owner' }).expect(201); const login = await request(server()).post('/api/v1/auth/login').send({ identifier: body<{ email: string }>(registration).email, password }).expect(200); token = body<{ accessToken: string }>(login).accessToken;
    const organization = await request(server()).post('/api/v1/organizations').set('Authorization', `Bearer ${token}`).send({ businessTypeCode: 'MINING_SUPPLIER_B2B', name: 'PO Org', handle: `po-${Date.now()}`, defaultCurrency: 'EUR', establishmentName: 'Main' }).expect(201); const organizationBody = body<{ id: string; establishment: { id: string } }>(organization); organizationId = organizationBody.id; establishmentId = organizationBody.establishment.id;
    const business = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'BUSINESS', version: 1 } }, select: { id: true } }); await prisma.subscription.updateMany({ where: { organizationId }, data: { planVersionId: business.id } });
    const party = await request(server()).post(`/api/v1/organizations/${organizationId}/parties`).set('Authorization', `Bearer ${token}`).send({ type: 'SUPPLIER', displayName: 'Supplier One', email: 'supplier@example.com' }).expect(201); partyId = body<{ id: string }>(party).id;
  }, 60000);
  afterAll(async () => { if (!app) return; await prisma.goodsReceiptCorrectionLine.deleteMany(); await prisma.goodsReceiptCorrection.deleteMany(); await prisma.goodsReceiptLine.deleteMany(); await prisma.goodsReceipt.deleteMany(); await prisma.purchaseOrderLine.deleteMany(); await prisma.purchaseOrder.deleteMany(); await prisma.supplierRFQRecipient.deleteMany(); await prisma.supplierRFQLine.deleteMany(); await prisma.supplierRFQ.deleteMany(); await app.close(); });

  it('creates a direct purchase order, calculates money, snapshots the supplier, and replays idempotently', async () => {
    const payload = { establishmentId, supplierPartyId: partyId, currency: 'EUR', lines: [{ descriptionSnapshot: 'Steel', unitSnapshot: 'KG', quantity: '10', unitPrice: '12', taxMode: 'EXCLUSIVE', taxRate: '20' }] };
    const first = await request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'po-create-1').send(payload).expect(201); const created = body<{ id: string; status: string; supplierDisplayName: string; totalNet: string; totalTax: string; totalGross: string; lines: Array<{ quantity: string }> }>(first); const firstLine = created.lines[0]; if (!firstLine) throw new Error('Purchase order line missing'); expect(created).toMatchObject({ status: 'DRAFT', supplierDisplayName: 'Supplier One', totalNet: '120.0000', totalTax: '24.0000', totalGross: '144.0000' }); expect(firstLine.quantity).toBe('10.000000'); expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: created.id }, select: { totalNet: true, totalTax: true, totalGross: true } })).totalGross.toFixed(4)).toBe('144.0000');
    const replay = await request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'po-create-1').send(payload).expect(201); expect(body<{ id: string }>(replay).id).toBe(created.id);
    await request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'po-create-1').send({ ...payload, notes: 'different' }).expect(409);
    await expect(prisma.outboxEvent.count({ where: { eventType: 'purchases.purchase_order.created.v1', aggregateId: created.id } })).resolves.toBe(1);
  });

  it('supports RFQ attribution and the explicit order lifecycle without creating inventory state', async () => {
    const rfq = await request(server()).post(`/api/v1/organizations/${organizationId}/supplier-rfqs`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'po-source-rfq').send({ establishmentId, title: 'Sourcing', currency: 'EUR', lines: [{ descriptionSnapshot: 'Copper', unitSnapshot: 'KG', quantity: '5' }], recipients: [{ localPartyId: partyId }] }).expect(201); const rfqBody = body<{ id: string; recipients: Array<{ id: string }>; lines: Array<{ id: string }> }>(rfq); const recipient = rfqBody.recipients[0]; const line = rfqBody.lines[0]; if (!recipient || !line) throw new Error('RFQ response incomplete');
    await request(server()).post(`/api/v1/organizations/${organizationId}/supplier-rfqs/${rfqBody.id}/send`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'po-source-rfq-send').expect(200);
    const order = await request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'po-from-rfq').send({ establishmentId, sourceSupplierRfqId: rfqBody.id, sourceRecipientId: recipient.id, currency: 'EUR', lines: [{ sourceRfqLineId: line.id, descriptionSnapshot: 'ignored', unitSnapshot: 'ignored', quantity: '2', unitPrice: '10', taxMode: 'EXCLUSIVE', taxRate: '0' }] }).expect(201); const orderBody = body<{ id: string; sourceSupplierRfqId: string; sourceRecipientId: string; status: string }>(order); expect(orderBody).toMatchObject({ sourceSupplierRfqId: rfqBody.id, sourceRecipientId: recipient.id, status: 'DRAFT' });
    const orderId = orderBody.id; await request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders/${orderId}/send`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'po-send').expect(200); await request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders/${orderId}/confirm`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'po-confirm').expect(200); await request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders/${orderId}/confirm`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'po-confirm').expect(200); expect(await prisma.goodsReceipt.count({ where: { organizationId } })).toBe(0);
  });
});

function body<T>(response: Response): T { return response.body as T; }
function server(): Parameters<typeof request>[0] { return appRef().getHttpServer() as Parameters<typeof request>[0]; }
let appRefValue: INestApplication;
function appRef(): INestApplication { return appRefValue; }
