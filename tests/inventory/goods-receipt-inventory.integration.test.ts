import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID, generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';
import { exportPKCS8, exportSPKI } from 'jose';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../src/database/prisma.service.js';
import { EventWorker } from '../../src/events/event-worker.js';
import { GoodsReceiptInventoryService } from '../../src/inventory/goods-receipt-inventory.service.js';
import { seedReferenceData } from '../../prisma/seed.js';

describe('GoodsReceipt to Inventory integration', () => {
  let prisma: PrismaService;
  let worker: EventWorker;
  let inventory: GoodsReceiptInventoryService;
  let organizationId: string;
  let establishmentId: string;
  let warehouseId: string;
  let importWarehouseId: string;
  let itemId: string;
  let receiptId: string;
  let receiptLineId: string;
  let purchaseOrderId: string;
  const actor = { userId: randomUUID(), sessionId: randomUUID() };
  const fixtureSubscriptionStart = new Date('2020-01-01T00:00:00.000Z');

  beforeAll(async () => {
    const { privateKey, publicKey } = await promisify(generateKeyPair)('rsa', { modulusLength: 2048 });
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_phase7_task3_test';
    process.env.JWT_ISSUER = 'phase7-goods-receipt-test'; process.env.JWT_AUDIENCE = 'phase7-goods-receipt-api'; process.env.JWT_KEY_ID = 'phase7-goods-receipt';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey); process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);
    const { AppModule } = await import('../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService); worker = moduleRef.get(EventWorker); inventory = moduleRef.get(GoodsReceiptInventoryService);
    await prisma.eventConsumerReceipt.deleteMany();
    await prisma.outboxEvent.deleteMany();
    await seedReferenceData(prisma);
    const businessType = await prisma.businessType.findFirstOrThrow({ select: { code: true } });
    organizationId = randomUUID(); establishmentId = randomUUID(); warehouseId = randomUUID(); importWarehouseId = randomUUID(); itemId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, businessTypeCode: businessType.code, name: 'Goods receipt inventory test', handle: `goods-receipt-inventory-${Date.now()}`, defaultCurrency: 'EUR' } });
    const plan = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'BUSINESS', version: 1 } }, include: { modules: true } });
    await prisma.subscription.create({ data: { id: randomUUID(), organizationId, planVersionId: plan.id, status: 'ACTIVE', startsAt: fixtureSubscriptionStart } });
    await prisma.organizationModuleActivation.createMany({ data: plan.modules.map((module) => ({ id: randomUUID(), organizationId, moduleCode: module.moduleCode, enabled: true })) });
    await prisma.establishment.create({ data: { id: establishmentId, organizationId, code: 'MAIN', name: 'Main', type: 'HEAD_OFFICE' } });
    await prisma.warehouse.createMany({ data: [
      { id: warehouseId, organizationId, establishmentId, code: 'MAIN', name: 'Main warehouse' },
      { id: importWarehouseId, organizationId, establishmentId, code: 'IMPORT', name: 'Historical import warehouse' },
    ] });
    await prisma.item.create({ data: { id: itemId, organizationId, type: 'PRODUCT', name: 'Tracked item', unit: 'piece', referencePrice: '1', currency: 'EUR', trackInventory: true } });
    const email = `goods-receipt-inventory-${actor.userId}@example.com`;
    await prisma.user.create({ data: { id: actor.userId, email, normalizedEmail: email, passwordHash: 'not-used', firstName: 'Inventory', lastName: 'Tester' } });
    await prisma.membership.create({ data: { id: randomUUID(), organizationId, userId: actor.userId, role: 'OWNER', scopeMode: 'ALL_ESTABLISHMENTS' } });
    const orderId = randomUUID(); purchaseOrderId = orderId;
    const orderLineId = randomUUID();
    receiptId = randomUUID(); receiptLineId = randomUUID();
    const supplierPartyId = randomUUID();
    await prisma.businessParty.create({ data: { id: supplierPartyId, organizationId, type: 'SUPPLIER', displayName: 'Supplier' } });
    await prisma.purchaseOrder.create({ data: { id: orderId, organizationId, establishmentId, number: 'PO-TEST-1', status: 'CONFIRMED', supplierPartyId, supplierKind: 'LOCAL_PARTY', supplierDisplayNameSnapshot: 'Supplier', currency: 'EUR', totalNet: '20', totalTax: '0', totalGross: '20', lines: { create: { id: orderLineId, lineIndex: 1, itemId, itemNameSnapshot: 'Tracked item', unitSnapshot: 'piece', quantityOrdered: '2', unitPrice: '10', discountAmount: '0', taxMode: 'EXCLUSIVE', taxRate: '0', netAmount: '20', taxAmount: '0', grossAmount: '20' } } } });
    await prisma.goodsReceipt.create({ data: { id: receiptId, organizationId, establishmentId, purchaseOrderId: orderId, number: 'GR-TEST-1', status: 'CONFIRMED', receivedAt: new Date('2026-10-14T08:00:00.000Z'), lines: { create: { id: receiptLineId, purchaseOrderLineId: orderLineId, lineIndex: 1, itemId, itemNameSnapshot: 'Tracked item', unitSnapshot: 'piece', quantity: '2' } } } });
  }, 60000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.goodsReceiptInventoryEntry.deleteMany({ where: { organizationId } });
    await prisma.goodsReceiptInventoryLink.deleteMany({ where: { organizationId } });
    await prisma.goodsReceiptCorrectionLine.deleteMany({ where: { organizationId } });
    await prisma.goodsReceiptCorrection.deleteMany({ where: { organizationId } });
    await prisma.goodsReceipt.deleteMany({ where: { organizationId } });
    await prisma.purchaseOrder.deleteMany({ where: { organizationId } });
    await prisma.businessParty.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.delete({ where: { id: actor.userId } });
    await prisma.$disconnect();
  });

  it('keeps receipt facts pending, applies one assignment, replays idempotently, and posts corrections', async () => {
    const confirmedEventId = await insertEvent('purchases.goods_receipt.confirmed.v1', 'CONFIRMED', [{ goodsReceiptLineId: receiptLineId, itemId, deltaQuantity: '2.000000' }]);
    await worker.processBatch({ workerId: 'goods-receipt-test-1' });
    await expect(prisma.outboxEvent.findUniqueOrThrow({ where: { id: confirmedEventId } })).resolves.toMatchObject({ status: 'PROCESSED' });
    await expect(prisma.goodsReceiptInventoryLink.findUniqueOrThrow({ where: { goodsReceiptId_organizationId: { goodsReceiptId: receiptId, organizationId } } })).resolves.toMatchObject({ status: 'PENDING_ASSIGNMENT', warehouseId: null });
    await expect(prisma.inventoryMovement.count({ where: { organizationId, sourceId: receiptId } })).resolves.toBe(0);

    await prisma.outboxEvent.update({ where: { id: confirmedEventId }, data: { status: 'PENDING', processedAt: null, attempts: 0, nextAttemptAt: null } });
    await worker.processBatch({ workerId: 'goods-receipt-test-replay' });
    await expect(prisma.outboxEvent.findUniqueOrThrow({ where: { id: confirmedEventId } })).resolves.toMatchObject({ status: 'PROCESSED' });
    await expect(prisma.goodsReceiptInventoryEntry.count({ where: { organizationId, goodsReceiptId: receiptId } })).resolves.toBe(1);

    await prisma.item.update({ where: { id: itemId }, data: { active: false } });
    await expect(inventory.assign(actor, organizationId, receiptId, { establishmentId, warehouseId, reason: 'Should roll back' }, 'goods-receipt-assignment-rollback')).rejects.toThrow('Inventory warehouse or item not found');
    await expect(prisma.goodsReceiptInventoryLink.findUniqueOrThrow({ where: { goodsReceiptId_organizationId: { goodsReceiptId: receiptId, organizationId } } })).resolves.toMatchObject({ status: 'PENDING_ASSIGNMENT', warehouseId: null });
    await expect(prisma.inventoryMovement.count({ where: { organizationId, sourceId: receiptId } })).resolves.toBe(0);
    await prisma.item.update({ where: { id: itemId }, data: { active: true } });

    const assigned = await inventory.assign(actor, organizationId, receiptId, { establishmentId, warehouseId, reason: 'Explicit receiving warehouse' }, 'goods-receipt-assignment-1');
    expect(assigned).toMatchObject({ status: 'ASSIGNED', warehouseId });
    await expect(prisma.inventoryMovement.count({ where: { organizationId, sourceId: receiptId } })).resolves.toBe(1);
    await expect(prisma.inventoryBalance.findUniqueOrThrow({ where: { organizationId_warehouseId_itemId: { organizationId, warehouseId, itemId } } }).then((balance) => balance.quantity.toFixed(6))).resolves.toBe('2.000000');
    await expect(inventory.assign(actor, organizationId, receiptId, { establishmentId, warehouseId, reason: 'Replay' }, 'goods-receipt-assignment-2')).resolves.toEqual(assigned);
    await expect(prisma.inventoryMovement.count({ where: { organizationId, sourceId: receiptId } })).resolves.toBe(1);

    const correctionId = randomUUID();
    await prisma.goodsReceiptCorrection.create({ data: { id: correctionId, organizationId, goodsReceiptId: receiptId, reason: 'Inventory correction', createdByUserId: actor.userId } });
    await prisma.goodsReceiptCorrectionLine.create({ data: { id: randomUUID(), organizationId, correctionId, goodsReceiptId: receiptId, goodsReceiptLineId: receiptLineId, deltaQuantity: '-0.500000' } });
    const correctionEventId = await insertEvent('purchases.goods_receipt.corrected.v1', correctionId, [{ goodsReceiptLineId: receiptLineId, itemId, deltaQuantity: '-0.500000' }]);
    await worker.processBatch({ workerId: 'goods-receipt-test-correction' });
    await expect(prisma.outboxEvent.findUniqueOrThrow({ where: { id: correctionEventId } })).resolves.toMatchObject({ status: 'PROCESSED' });
    await expect(prisma.inventoryMovement.count({ where: { organizationId, sourceId: receiptId } })).resolves.toBe(2);
    await expect(prisma.inventoryBalance.findUniqueOrThrow({ where: { organizationId_warehouseId_itemId: { organizationId, warehouseId, itemId } } }).then((balance) => balance.quantity.toFixed(6))).resolves.toBe('1.500000');
    await expect(prisma.goodsReceiptInventoryEntry.count({ where: { organizationId, goodsReceiptId: receiptId, inventoryMovementId: { not: null } } })).resolves.toBe(2);
  });

  it('imports a confirmed receipt without an event exactly once', async () => {
    const importReceiptId = randomUUID(); const importLineId = randomUUID(); const orderId = randomUUID(); const orderLineId = randomUUID();
    const supplierPartyId = await prisma.businessParty.findFirstOrThrow({ where: { organizationId, type: 'SUPPLIER' }, select: { id: true } });
    await prisma.purchaseOrder.create({ data: { id: orderId, organizationId, establishmentId, number: 'PO-TEST-2', status: 'CONFIRMED', supplierPartyId: supplierPartyId.id, supplierKind: 'LOCAL_PARTY', supplierDisplayNameSnapshot: 'Supplier', currency: 'EUR', totalNet: '10', totalTax: '0', totalGross: '10', lines: { create: { id: orderLineId, lineIndex: 1, itemId, itemNameSnapshot: 'Tracked item', unitSnapshot: 'piece', quantityOrdered: '1', unitPrice: '10', discountAmount: '0', taxMode: 'EXCLUSIVE', taxRate: '0', netAmount: '10', taxAmount: '0', grossAmount: '10' } } } });
    await prisma.goodsReceipt.create({ data: { id: importReceiptId, organizationId, establishmentId, purchaseOrderId: orderId, number: 'GR-TEST-2', status: 'CONFIRMED', receivedAt: new Date(), lines: { create: { id: importLineId, purchaseOrderLineId: orderLineId, lineIndex: 1, itemId, itemNameSnapshot: 'Tracked item', unitSnapshot: 'piece', quantity: '1' } } } });
    const imported = await inventory.importHistorical(actor, organizationId, importReceiptId, { establishmentId, warehouseId: importWarehouseId, reason: 'Audited historical import' }, 'goods-receipt-import-1');
    expect(imported).toMatchObject({ status: 'IMPORTED', warehouseId: importWarehouseId });
    await expect(inventory.importHistorical(actor, organizationId, importReceiptId, { establishmentId, warehouseId: importWarehouseId, reason: 'Replay' }, 'goods-receipt-import-2')).resolves.toEqual(imported);
    await expect(prisma.inventoryMovement.count({ where: { organizationId, sourceId: importReceiptId } })).resolves.toBe(1);
  });

  it('rejects historical import while a receipt event is pending', async () => {
    const pendingReceiptId = randomUUID(); const pendingLineId = randomUUID(); const orderId = randomUUID(); const orderLineId = randomUUID();
    const supplierPartyId = await prisma.businessParty.findFirstOrThrow({ where: { organizationId, type: 'SUPPLIER' }, select: { id: true } });
    await prisma.purchaseOrder.create({ data: { id: orderId, organizationId, establishmentId, number: 'PO-TEST-3', status: 'CONFIRMED', supplierPartyId: supplierPartyId.id, supplierKind: 'LOCAL_PARTY', supplierDisplayNameSnapshot: 'Supplier', currency: 'EUR', totalNet: '10', totalTax: '0', totalGross: '10', lines: { create: { id: orderLineId, lineIndex: 1, itemId, itemNameSnapshot: 'Tracked item', unitSnapshot: 'piece', quantityOrdered: '1', unitPrice: '10', discountAmount: '0', taxMode: 'EXCLUSIVE', taxRate: '0', netAmount: '10', taxAmount: '0', grossAmount: '10' } } } });
    await prisma.goodsReceipt.create({ data: { id: pendingReceiptId, organizationId, establishmentId, purchaseOrderId: orderId, number: 'GR-TEST-3', status: 'CONFIRMED', receivedAt: new Date(), lines: { create: { id: pendingLineId, purchaseOrderLineId: orderLineId, lineIndex: 1, itemId, itemNameSnapshot: 'Tracked item', unitSnapshot: 'piece', quantity: '1' } } } });
    const eventId = randomUUID();
    await prisma.outboxEvent.create({ data: { id: eventId, eventType: 'purchases.goods_receipt.confirmed.v1', eventVersion: 1, occurredAt: new Date(), organizationId, establishmentId, actorType: 'USER', actorId: actor.userId, aggregateType: 'GoodsReceipt', aggregateId: pendingReceiptId, correlationId: randomUUID(), dataClassification: 'CONFIDENTIAL', purpose: 'purchases-goods-receipt', payloadJson: { goodsReceiptId: pendingReceiptId, purchaseOrderId: orderId, establishmentId, sourceRevision: 'CONFIRMED', lines: [{ goodsReceiptLineId: pendingLineId, itemId, deltaQuantity: '1.000000' }] } } });
    await expect(inventory.importHistorical(actor, organizationId, pendingReceiptId, { establishmentId, warehouseId, reason: 'Must wait for event projection' }, 'goods-receipt-import-pending')).rejects.toThrow('event-backed receipt must be replayed');
    await expect(prisma.goodsReceiptInventoryLink.findUnique({ where: { goodsReceiptId_organizationId: { goodsReceiptId: pendingReceiptId, organizationId } } })).resolves.toBeNull();
    await prisma.outboxEvent.delete({ where: { id: eventId } });
    await prisma.goodsReceipt.delete({ where: { id: pendingReceiptId } });
    await prisma.purchaseOrder.delete({ where: { id: orderId } });
  });

  async function insertEvent(eventType: string, sourceRevision: string, lines: Array<{ goodsReceiptLineId: string; itemId: string | null; deltaQuantity: string }>): Promise<string> {
    const id = randomUUID();
    await prisma.outboxEvent.create({ data: { id, eventType, eventVersion: 1, occurredAt: new Date(), organizationId, establishmentId, actorType: 'USER', actorId: actor.userId, aggregateType: 'GoodsReceipt', aggregateId: receiptId, correlationId: randomUUID(), dataClassification: 'CONFIDENTIAL', purpose: 'purchases-goods-receipt', payloadJson: { goodsReceiptId: receiptId, purchaseOrderId, establishmentId, sourceRevision, lines } } });
    return id;
  }
});
