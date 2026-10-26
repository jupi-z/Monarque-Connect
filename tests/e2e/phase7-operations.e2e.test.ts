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
import { EventWorker } from '../../src/events/event-worker.js';
import { ProblemDetailsFilter } from '../../src/http/problem-details.filter.js';
import { seedReferenceData } from '../../prisma/seed.js';

const password = 'correct horse battery staple';
const generateKeyPairAsync = promisify(generateKeyPair);

describe('Phase 7 Operations HTTP E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: EventWorker;
  let token = '';
  let organizationId = '';
  let establishmentId = '';

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_phase7_operations_e2e';
    process.env.CORS_ORIGINS = '';
    process.env.JWT_ISSUER = 'monarque-connect-phase7-operations-e2e';
    process.env.JWT_AUDIENCE = 'monarque-connect-phase7-operations-api';
    process.env.JWT_KEY_ID = 'phase7-operations-e2e';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey);
    process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    worker = app.get(EventWorker);
    await seedReferenceData(prisma);

    const suffix = Date.now();
    token = await registerAndLogin(`phase7-operations-${suffix}@example.com`, 'Phase7 Operations');
    const organization = bodyOf<{ id: string; establishment: { id: string } }>(await request(server()).post('/api/v1/organizations').set('Authorization', `Bearer ${token}`).send({ businessTypeCode: 'COMMERCE_DISTRIBUTION', name: 'Phase 7 Operations E2E', handle: `phase7-operations-${suffix}`, defaultCurrency: 'EUR', establishmentName: 'Main office' }).expect(201));
    organizationId = organization.id;
    establishmentId = organization.establishment.id;
    await upgradeToBusiness();
  }, 60000);

  afterAll(async () => {
    if (!app) return;
    if (organizationId) {
      await prisma.goodsReceiptInventoryEntry.deleteMany({ where: { organizationId } });
      await prisma.goodsReceiptInventoryLink.deleteMany({ where: { organizationId } });
      await prisma.goodsReceiptCorrectionLine.deleteMany({ where: { organizationId } });
      await prisma.goodsReceiptCorrection.deleteMany({ where: { organizationId } });
      await prisma.goodsReceipt.deleteMany({ where: { organizationId } });
      await prisma.purchaseOrderLine.deleteMany({ where: { organizationId } });
      await prisma.purchaseOrder.deleteMany({ where: { organizationId } });
      await prisma.supplierRFQRecipient.deleteMany({ where: { organizationId } });
      await prisma.supplierRFQLine.deleteMany({ where: { organizationId } });
      await prisma.supplierRFQ.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    await app.close();
  });

  it('records an Expense and uses it as a validated Cash source', async () => {
    const account = bodyOf<{ id: string }>(await request(server()).post(`/api/v1/organizations/${organizationId}/cash-accounts`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-operations-account').send({ establishmentId, code: 'OPERATIONS-CASH', name: 'Operations cash', currency: 'EUR' }).expect(201));
    await request(server()).post(`/api/v1/organizations/${organizationId}/cash-movements`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-operations-opening').send({ establishmentId, cashAccountId: account.id, direction: 'IN', amount: '100.0000', occurredAt: '2026-10-14T12:00:00.000Z', reason: 'Opening balance' }).expect(201);

    const expense = bodyOf<{ id: string; status: string }>(await request(server()).post(`/api/v1/organizations/${organizationId}/expenses`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-operations-expense-create').send({ establishmentId, description: 'E2E operating expense', category: 'SUPPLIES', amount: '25.0000', currency: 'EUR', expenseDate: '2026-10-14' }).expect(201));
    expect(expense.status).toBe('DRAFT');
    await request(server()).post(`/api/v1/organizations/${organizationId}/expenses/${expense.id}/record`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-operations-expense-record').send({}).expect(201);
    const movement = bodyOf<{ id: string; sourceType: string; sourceId: string }>(await request(server()).post(`/api/v1/organizations/${organizationId}/cash-movements`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-operations-expense-cash').send({ establishmentId, cashAccountId: account.id, direction: 'OUT', amount: '25.0000', occurredAt: '2026-10-14T12:01:00.000Z', reason: 'Pay operating expense', sourceType: 'EXPENSE', sourceId: expense.id }).expect(201));

    expect(movement).toMatchObject({ sourceType: 'EXPENSE', sourceId: expense.id });
    const stored = await prisma.cashMovement.findFirstOrThrow({ where: { id: movement.id, organizationId } });
    expect(stored.sourceId).toBe(expense.id);
    await expectBalance(account.id, '75.0000');
  });

  it('projects a confirmed GoodsReceipt into Inventory after explicit assignment', async () => {
    const item = bodyOf<{ id: string }>(await request(server()).post(`/api/v1/organizations/${organizationId}/items`).set('Authorization', `Bearer ${token}`).send({ type: 'PRODUCT', sku: 'PHASE7-E2E-ITEM', name: 'Phase 7 E2E item', unit: 'EA', referencePrice: '10', currency: 'EUR', trackInventory: true }).expect(201));
    const warehouse = bodyOf<{ id: string }>(await request(server()).post(`/api/v1/organizations/${organizationId}/establishments/${establishmentId}/warehouses`).set('Authorization', `Bearer ${token}`).send({ code: 'PHASE7-E2E', name: 'Phase 7 E2E warehouse' }).expect(201));
    const party = bodyOf<{ id: string }>(await request(server()).post(`/api/v1/organizations/${organizationId}/parties`).set('Authorization', `Bearer ${token}`).send({ type: 'SUPPLIER', displayName: 'Phase 7 E2E supplier' }).expect(201));
    const rfq = bodyOf<{ id: string; recipients: Array<{ id: string }>; lines: Array<{ id: string }> }>(await request(server()).post(`/api/v1/organizations/${organizationId}/supplier-rfqs`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-operations-rfq-create').send({ establishmentId, title: 'Phase 7 E2E sourcing', currency: 'EUR', lines: [{ itemId: item.id, descriptionSnapshot: 'Phase 7 E2E item', unitSnapshot: 'EA', quantity: '2' }], recipients: [{ localPartyId: party.id }] }).expect(201));
    await request(server()).post(`/api/v1/organizations/${organizationId}/supplier-rfqs/${rfq.id}/send`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-operations-rfq-send').expect(200);
    const order = bodyOf<{ id: string; lines: Array<{ id: string }> }>(await request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-operations-order-create').send({ establishmentId, sourceSupplierRfqId: rfq.id, sourceRecipientId: rfq.recipients[0]!.id, currency: 'EUR', lines: [{ sourceRfqLineId: rfq.lines[0]!.id, descriptionSnapshot: 'Phase 7 E2E item', unitSnapshot: 'EA', quantity: '2', unitPrice: '10', taxMode: 'EXCLUSIVE', taxRate: '0' }] }).expect(201));
    await request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders/${order.id}/send`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-operations-order-send').expect(200);
    await request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders/${order.id}/confirm`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-operations-order-confirm').expect(200);
    const receipt = bodyOf<{ id: string; lines: Array<{ id: string }> }>(await request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders/${order.id}/receipts`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-operations-receipt-create').send({ receivedAt: '2026-10-14T12:00:00.000Z', reference: 'PHASE7-E2E-GR', lines: [{ purchaseOrderLineId: order.lines[0]!.id, quantity: '2' }] }).expect(201));
    await request(server()).post(`/api/v1/organizations/${organizationId}/purchase-orders/${order.id}/receipts/${receipt.id}/confirm`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-operations-receipt-confirm').expect(200);

    for (let attempt = 0; attempt < 5; attempt += 1) if ((await worker.processBatch({ workerId: `phase7-operations-e2e-${attempt}` })) === 0) break;
    const pending = bodyOf<{ items: Array<{ goodsReceiptId: string }> }>(await request(server()).get(`/api/v1/organizations/${organizationId}/inventory/goods-receipts/pending?establishmentId=${establishmentId}`).set('Authorization', `Bearer ${token}`).expect(200));
    expect(pending.items.some((entry) => entry.goodsReceiptId === receipt.id)).toBe(true);

    await request(server()).post(`/api/v1/organizations/${organizationId}/inventory/goods-receipts/${receipt.id}/assignment`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-operations-receipt-assignment').send({ establishmentId, warehouseId: warehouse.id, reason: 'Explicit E2E assignment' }).expect(200);
    const balance = await prisma.inventoryBalance.findUniqueOrThrow({ where: { organizationId_warehouseId_itemId: { organizationId, warehouseId: warehouse.id, itemId: item.id } } });
    expect(balance.quantity.toFixed(6)).toBe('2.000000');
    expect(await prisma.inventoryMovement.count({ where: { organizationId, sourceId: receipt.id } })).toBe(1);

    const balancesResponse = await request(server()).get(`/api/v1/organizations/${organizationId}/inventory/balances?establishmentId=${establishmentId}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(bodyOf<{ items: Array<Record<string, unknown>> }>(balancesResponse).items).toEqual(expect.arrayContaining([expect.objectContaining({ warehouseId: warehouse.id, itemId: item.id, quantity: '2.000000' })]));
    const movementsResponse = await request(server()).get(`/api/v1/organizations/${organizationId}/inventory/movements?establishmentId=${establishmentId}&warehouseId=${warehouse.id}&itemId=${item.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(bodyOf<{ items: Array<Record<string, unknown>> }>(movementsResponse).items).toHaveLength(1);
    const adjustment = await request(server()).post(`/api/v1/organizations/${organizationId}/inventory/movements`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-inventory-adjustment').send({ establishmentId, warehouseId: warehouse.id, itemId: item.id, movementType: 'ADJUSTMENT_IN', quantityDelta: '1.000000', occurredAt: '2026-10-14T12:02:00.000Z', reason: 'HTTP inventory hardening' }).expect(201);
    expect(adjustment.body).toMatchObject({ movementType: 'ADJUSTMENT_IN', quantityDelta: '1.000000' });
    await request(server()).post(`/api/v1/organizations/${organizationId}/inventory/movements`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-inventory-adjustment').send({ establishmentId, warehouseId: warehouse.id, itemId: item.id, movementType: 'ADJUSTMENT_IN', quantityDelta: '2.000000', occurredAt: '2026-10-14T12:02:00.000Z', reason: 'HTTP inventory hardening' }).expect(409);
    await request(server()).post(`/api/v1/organizations/${organizationId}/stock-movements`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-inventory-legacy-adjustment').send({ establishmentId, warehouseId: warehouse.id, itemId: item.id, movementType: 'ADJUSTMENT_IN', quantityDelta: '1.000000', occurredAt: '2026-10-14T12:03:00.000Z', reason: 'Legacy compatibility' }).expect(201);
    await request(server()).post(`/api/v1/organizations/${organizationId}/inventory/movements`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-inventory-unilateral-transfer').send({ establishmentId, warehouseId: warehouse.id, itemId: item.id, movementType: 'TRANSFER_OUT', quantityDelta: '1.000000', occurredAt: '2026-10-14T12:04:00.000Z', reason: 'Must be rejected' }).expect(400);
    const destination = bodyOf<{ id: string }>(await request(server()).post(`/api/v1/organizations/${organizationId}/establishments/${establishmentId}/warehouses`).set('Authorization', `Bearer ${token}`).send({ code: 'PHASE7-E2E-DEST', name: 'Phase 7 E2E destination' }).expect(201));
    await request(server()).post(`/api/v1/organizations/${organizationId}/inventory/transfers`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-inventory-transfer').send({ establishmentId, sourceWarehouseId: warehouse.id, destinationWarehouseId: destination.id, itemId: item.id, quantity: '1.000000', occurredAt: '2026-10-14T12:05:00.000Z', reason: 'HTTP transfer' }).expect(201);
    const reconciliationResponse = await request(server()).post(`/api/v1/organizations/${organizationId}/inventory/reconciliation`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-inventory-reconciliation').send({ establishmentId, warehouseId: warehouse.id, itemId: item.id, observedQuantity: '3.000000' }).expect(200);
    expect(bodyOf<Record<string, unknown>>(reconciliationResponse)).toMatchObject({ matched: true, delta: '0.000000' });
    await request(server()).get(`/api/v1/organizations/${organizationId}/inventory/balances`).expect(401);
    await request(server()).get('/api/v1/organizations/00000000-0000-0000-0000-000000000001/inventory/balances').set('Authorization', `Bearer ${token}`).expect(403);
    await request(server()).post(`/api/v1/organizations/${organizationId}/inventory/transfers`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'phase7-inventory-not-found').send({ establishmentId, sourceWarehouseId: randomUUID(), destinationWarehouseId: destination.id, itemId: item.id, quantity: '1.000000', occurredAt: '2026-10-14T12:06:00.000Z', reason: 'Not found' }).expect(404);
  });

  async function registerAndLogin(email: string, name: string): Promise<string> {
    const [firstName, lastName] = name.split(' ');
    const registration = await request(server()).post('/api/v1/auth/register').send({ email, password, firstName, lastName }).expect(201);
    const login = await request(server()).post('/api/v1/auth/login').send({ identifier: bodyOf<{ email: string }>(registration).email, password }).expect(200);
    return bodyOf<{ accessToken: string }>(login).accessToken;
  }

  async function upgradeToBusiness(): Promise<void> {
    const plan = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'BUSINESS', version: 1 } }, select: { id: true } });
    await prisma.subscription.updateMany({ where: { organizationId }, data: { planVersionId: plan.id, startsAt: new Date('2020-01-01T00:00:00.000Z') } });
  }

  async function expectBalance(cashAccountId: string, expected: string): Promise<void> {
    const rows = await prisma.cashMovement.findMany({ where: { organizationId, cashAccountId }, select: { direction: true, amount: true } });
    const balance = rows.reduce((total, row) => total + (row.direction === 'IN' ? Number(row.amount) : -Number(row.amount)), 0);
    expect(balance.toFixed(4)).toBe(expected);
  }

  function server(): Parameters<typeof request>[0] { return app.getHttpServer() as Parameters<typeof request>[0]; }
});

function bodyOf<T>(response: Response): T { return response.body as T; }
