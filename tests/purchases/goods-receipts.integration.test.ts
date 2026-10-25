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
import { expectHttpStatusWithDiagnostics } from '../setup/http-diagnostics.js';
import { authorizationSnapshot } from '../setup/authorization-snapshot.js';

const generateKeyPairAsync = promisify(generateKeyPair);
const password = 'correct horse battery staple';

describe('Phase 6 Goods Receipts', () => {
  let app: INestApplication; let prisma: PrismaService; let token = ''; let organizationId = ''; let establishmentId = ''; let partyId = '';

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_phase6_task3_test'; process.env.CORS_ORIGINS = ''; process.env.JWT_ISSUER = 'phase6-gr-test'; process.env.JWT_AUDIENCE = 'phase6-gr-api'; process.env.JWT_KEY_ID = 'phase6-gr'; process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey); process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile(); app = moduleRef.createNestApplication(); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); app.useGlobalFilters(new ProblemDetailsFilter()); await app.init(); appRefValue = app; prisma = app.get(PrismaService);
    await prisma.goodsReceiptCorrectionLine.deleteMany(); await prisma.goodsReceiptCorrection.deleteMany(); await prisma.goodsReceiptLine.deleteMany(); await prisma.goodsReceipt.deleteMany(); await prisma.purchaseOrderLine.deleteMany(); await prisma.purchaseOrder.deleteMany(); await prisma.supplierRFQRecipient.deleteMany(); await prisma.supplierRFQLine.deleteMany(); await prisma.supplierRFQ.deleteMany(); await prisma.paymentRecord.deleteMany(); await prisma.invoiceLine.deleteMany(); await prisma.invoice.deleteMany(); await prisma.salesOrderLine.deleteMany(); await prisma.salesOrder.deleteMany(); await prisma.quoteLine.deleteMany(); await prisma.quote.deleteMany(); await prisma.opportunity.deleteMany(); await prisma.lead.deleteMany(); await prisma.warehouse.deleteMany(); await prisma.connectionRequest.deleteMany(); await prisma.organizationNetworkProfile.deleteMany(); await prisma.businessParty.deleteMany(); await prisma.auditEvent.deleteMany(); await prisma.membershipEstablishmentScope.deleteMany(); await prisma.invitationEstablishmentScope.deleteMany(); await prisma.invitation.deleteMany(); await prisma.membership.deleteMany(); await prisma.establishment.deleteMany(); await prisma.organization.deleteMany(); await prisma.refreshSession.deleteMany(); await prisma.user.deleteMany(); await prisma.loginRateLimitBucket.deleteMany(); await prisma.eventConsumerReceipt.deleteMany(); await prisma.outboxEvent.deleteMany(); await seedReferenceData(prisma);
    const registration = await request(server()).post('/api/v1/auth/register').send({ email: `phase6-gr-${Date.now()}@example.com`, password, firstName: 'Goods', lastName: 'Receiver' }).expect(201); const login = await request(server()).post('/api/v1/auth/login').send({ identifier: body<{ email: string }>(registration).email, password }).expect(200); token = body<{ accessToken: string }>(login).accessToken;
    const organization = await request(server()).post('/api/v1/organizations').set('Authorization', `Bearer ${token}`).send({ businessTypeCode: 'MINING_SUPPLIER_B2B', name: 'Receipt Org', handle: `receipt-${Date.now()}`, defaultCurrency: 'EUR', establishmentName: 'Main' }).expect(201); const organizationBody = body<{ id: string; establishment: { id: string } }>(organization); organizationId = organizationBody.id; establishmentId = organizationBody.establishment.id;
    const business = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'BUSINESS', version: 1 } }, select: { id: true } }); await prisma.subscription.updateMany({ where: { organizationId }, data: { planVersionId: business.id, startsAt: new Date('2020-01-01T00:00:00.000Z') } });
    const party = await request(server()).post(`/api/v1/organizations/${organizationId}/parties`).set('Authorization', `Bearer ${token}`).send({ type: 'SUPPLIER', displayName: 'Receipt Supplier', email: 'receipt-supplier@example.com' }).expect(201); partyId = body<{ id: string }>(party).id;
  }, 60000);

  afterAll(async () => { if (!app) return; await prisma.goodsReceiptCorrectionLine.deleteMany(); await prisma.goodsReceiptCorrection.deleteMany(); await prisma.goodsReceiptLine.deleteMany(); await prisma.goodsReceipt.deleteMany(); await prisma.purchaseOrderLine.deleteMany(); await prisma.purchaseOrder.deleteMany(); await prisma.businessParty.deleteMany(); await prisma.auditEvent.deleteMany(); await prisma.membershipEstablishmentScope.deleteMany(); await prisma.invitationEstablishmentScope.deleteMany(); await prisma.invitation.deleteMany(); await prisma.membership.deleteMany(); await prisma.establishment.deleteMany(); await prisma.organization.deleteMany(); await prisma.refreshSession.deleteMany(); await prisma.user.deleteMany(); await prisma.loginRateLimitBucket.deleteMany(); await prisma.eventConsumerReceipt.deleteMany(); await prisma.outboxEvent.deleteMany(); await app.close(); });

  it('creates a draft, confirms a partial receipt, and exposes exact cumulative quantities', async () => {
    const order = await confirmedOrder('gr-partial', '5');
    const receipt = await createReceipt(order.id, '2', 'gr-partial-create');
    const draft = body<{ id: string; status: string }>(receipt); expect(draft.status).toBe('DRAFT');
    const confirmed = await confirmReceipt(order.id, draft.id, 'gr-partial-confirm'); const result = body<{ status: string; lines: Array<{ quantity: string; cumulativeQuantity: string }> }>(confirmed); expect(result.status).toBe('CONFIRMED'); expect(result.lines[0]).toMatchObject({ quantity: '2.000000', cumulativeQuantity: '2.000000' }); const confirmedEvent = await prisma.outboxEvent.findFirstOrThrow({ where: { organizationId, aggregateId: draft.id, eventType: 'purchases.goods_receipt.confirmed.v1' }, orderBy: { recordedAt: 'desc' } }); expect(confirmedEvent.payloadJson).toMatchObject({ goodsReceiptId: draft.id, lines: [{ deltaQuantity: '2.000000' }] });
    const orderAfter = body<{ status: string }>(await request(server()).get(`/api/v1/organizations/${organizationId}/purchase-orders/${order.id}`).set('Authorization', `Bearer ${token}`)); expect(orderAfter.status).toBe('PARTIALLY_RECEIVED');
  });

  it('reaches RECEIVED exactly and refuses over-receipt', async () => {
    const partialOrder = await confirmedOrder('gr-over', '5'); const first = body<{ id: string }>(await createReceipt(partialOrder.id, '2', 'gr-over-create-1')); await confirmReceipt(partialOrder.id, first.id, 'gr-over-confirm-1'); const excess = body<{ id: string }>(await createReceipt(partialOrder.id, '4', 'gr-over-create-2')); await request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders/${partialOrder.id}/receipts/${excess.id}/confirm`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'gr-over-confirm-2').expect(409);
    const exactOrder = await confirmedOrder('gr-exact', '5'); const exact = body<{ id: string }>(await createReceipt(exactOrder.id, '5', 'gr-exact-create')); const completed = body<{ status: string }>(await confirmReceipt(exactOrder.id, exact.id, 'gr-exact-confirm')); expect(completed.status).toBe('CONFIRMED');
    const orderResponse = await request(server()).get(`/api/v1/organizations/${organizationId}/purchase-orders/${exactOrder.id}`).set('Authorization', `Bearer ${token}`);
    await expectHttpStatusWithDiagnostics(orderResponse, 200, 'Goods Receipts integration', 'read purchase order after exact receipt', () => authorizationSnapshot(prisma, organizationId));
    expect(body<{ status: string }>(orderResponse).status).toBe('RECEIVED');
    await request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders/${exactOrder.id}/receipts`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'gr-exact-create-2').send({ receivedAt: new Date().toISOString(), lines: [{ purchaseOrderLineId: exactOrder.lineId, quantity: '1' }] }).expect(409);
  });

  it('supports cancellation of drafts and keeps confirmed receipts immutable', async () => {
    const order = await confirmedOrder('gr-cancel', '5'); const draft = body<{ id: string }>(await createReceipt(order.id, '1', 'gr-cancel-create')); await request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders/${order.id}/receipts/${draft.id}/cancel`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'gr-cancel-cancel').expect(200); await request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders/${order.id}/receipts/${draft.id}/confirm`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'gr-cancel-confirm').expect(409);
    const confirmed = body<{ id: string }>(await createReceipt(order.id, '1', 'gr-immutable-create')); await confirmReceipt(order.id, confirmed.id, 'gr-immutable-confirm'); await request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders/${order.id}/receipts/${confirmed.id}/cancel`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'gr-immutable-cancel').expect(409);
  });

  it('applies signed append-only corrections, rejects negative net quantities, and does not mutate Inventory', async () => {
    const order = await confirmedOrder('gr-correction', '5'); const receipt = body<{ id: string }>(await createReceipt(order.id, '5', 'gr-correction-create')); await confirmReceipt(order.id, receipt.id, 'gr-correction-confirm'); const before = await prisma.item.count({ where: { organizationId } });
    const corrected = await request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders/${order.id}/receipts/${receipt.id}/correct`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'gr-correction-1').send({ reason: 'Short shipment', lines: [{ purchaseOrderLineId: order.lineId, deltaQuantity: '-2' }] }).expect(200); const result = body<{ corrections: Array<{ reason: string }>; lines: Array<{ cumulativeQuantity: string }> }>(corrected); expect(result.corrections).toHaveLength(1); expect(result.corrections[0]?.reason).toBe('Short shipment'); expect(result.lines[0]?.cumulativeQuantity).toBe('3.000000');
    await request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders/${order.id}/receipts/${receipt.id}/correct`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'gr-correction-2').send({ reason: 'Impossible correction', lines: [{ purchaseOrderLineId: order.lineId, deltaQuantity: '-4' }] }).expect(409); expect(await prisma.item.count({ where: { organizationId } })).toBe(before);
  });

  it('serializes concurrent confirmations so only one consumes the remaining quantity', async () => {
    const order = await confirmedOrder('gr-concurrent', '1'); const first = body<{ id: string }>(await createReceipt(order.id, '1', 'gr-concurrent-create-1')); const second = body<{ id: string }>(await createReceipt(order.id, '1', 'gr-concurrent-create-2')); const responses = await Promise.all([confirmReceipt(order.id, first.id, 'gr-concurrent-confirm-1'), confirmReceipt(order.id, second.id, 'gr-concurrent-confirm-2')]); expect(responses.filter((response) => response.status === 200)).toHaveLength(1); expect(responses.filter((response) => response.status === 409)).toHaveLength(1);
  });

  async function confirmedOrder(key: string, quantity: string): Promise<{ id: string; lineId: string }> { const created = body<{ id: string; lines: Array<{ id: string }> }>(await request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `${key}-create`).send({ establishmentId, supplierPartyId: partyId, currency: 'EUR', lines: [{ descriptionSnapshot: 'Steel', unitSnapshot: 'KG', quantity, unitPrice: '10', taxMode: 'EXCLUSIVE', taxRate: '0' }] }).expect(201)); const orderId = created.id; await request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders/${orderId}/send`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `${key}-send`).expect(200); await request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders/${orderId}/confirm`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `${key}-confirm`).expect(200); const line = created.lines[0]; if (!line) throw new Error('Purchase order line missing'); return { id: orderId, lineId: line.id }; }
  async function createReceipt(orderId: string, quantity: string, key: string): Promise<Response> { return request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders/${orderId}/receipts`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', key).send({ receivedAt: new Date().toISOString(), lines: [{ purchaseOrderLineId: (await prisma.purchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: orderId }, select: { id: true } })).id, quantity }] }).expect(201); }
  async function confirmReceipt(orderId: string, receiptId: string, key: string): Promise<Response> { return request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders/${orderId}/receipts/${receiptId}/confirm`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', key).send().expect((response) => response); }
});

function body<T>(response: Response): T { return response.body as T; }
function server(): Parameters<typeof request>[0] { return appRefValue.getHttpServer() as Parameters<typeof request>[0]; }
let appRefValue!: INestApplication;
