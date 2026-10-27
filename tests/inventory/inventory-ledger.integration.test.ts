import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';
import { exportPKCS8, exportSPKI } from 'jose';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { InventoryMovementService } from '../../src/inventory/inventory-movement.service.js';
import { InventoryTransferService } from '../../src/inventory/inventory-transfer.service.js';
import { InventoryBalanceService } from '../../src/inventory/inventory-balance.service.js';
import { InventoryReconciliationService } from '../../src/inventory/inventory-reconciliation.service.js';
import { seedReferenceData } from '../../prisma/seed.js';

describe('Phase 7 authoritative Inventory ledger', () => {
  let prisma: PrismaService;
  let movements: InventoryMovementService;
  let organizationId: string;
  let establishmentId: string;
  let warehouseId: string;
  let destinationWarehouseId: string;
  let itemId: string;
  let transfers: InventoryTransferService;
  let balances: InventoryBalanceService;
  let reconciliations: InventoryReconciliationService;
  const actor = { userId: randomUUID(), sessionId: randomUUID() };
  const restrictedActor = { userId: randomUUID(), sessionId: randomUUID() };
  const fixtureSubscriptionStart = new Date('2020-01-01T00:00:00.000Z');

  beforeAll(async () => {
    const { privateKey, publicKey } = await promisify(generateKeyPair)('rsa', { modulusLength: 2048 });
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/monarque_connect_test';
    process.env.JWT_ISSUER = 'phase7-inventory-test';
    process.env.JWT_AUDIENCE = 'phase7-inventory-api';
    process.env.JWT_KEY_ID = 'phase7-inventory';
    process.env.JWT_PRIVATE_KEY_PEM = await exportPKCS8(privateKey);
    process.env.JWT_PUBLIC_KEY_PEM = await exportSPKI(publicKey);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    movements = moduleRef.get(InventoryMovementService);
    transfers = moduleRef.get(InventoryTransferService);
    balances = moduleRef.get(InventoryBalanceService);
    reconciliations = moduleRef.get(InventoryReconciliationService);

    await seedReferenceData(prisma);

    const businessType = await prisma.businessType.findFirstOrThrow({ select: { code: true } });
    organizationId = randomUUID();
    establishmentId = randomUUID();
    warehouseId = randomUUID();
    itemId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, businessTypeCode: businessType.code, name: 'Inventory ledger test', handle: `inventory-ledger-${Date.now()}`, defaultCurrency: 'EUR' } });
    const business = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'BUSINESS', version: 1 } }, include: { modules: true } });
    await prisma.subscription.create({ data: { id: randomUUID(), organizationId, planVersionId: business.id, status: 'ACTIVE', startsAt: fixtureSubscriptionStart } });
    await prisma.organizationModuleActivation.createMany({ data: business.modules.map((module) => ({ id: randomUUID(), organizationId, moduleCode: module.moduleCode, enabled: true })) });
    await prisma.establishment.create({ data: { id: establishmentId, organizationId, code: 'MAIN', name: 'Main', type: 'HEAD_OFFICE' } });
    await prisma.warehouse.create({ data: { id: warehouseId, organizationId, establishmentId, code: 'MAIN', name: 'Main warehouse' } });
    destinationWarehouseId = randomUUID();
    await prisma.warehouse.create({ data: { id: destinationWarehouseId, organizationId, establishmentId, code: 'SECOND', name: 'Second warehouse' } });
    await prisma.item.create({ data: { id: itemId, organizationId, type: 'PRODUCT', name: 'Ledger item', unit: 'piece', referencePrice: '1', currency: 'EUR', trackInventory: true } });
    const email = `inventory-ledger-${actor.userId}@example.com`;
    await prisma.user.create({ data: { id: actor.userId, email, normalizedEmail: email, passwordHash: 'not-used', firstName: 'Inventory', lastName: 'Tester' } });
    await prisma.membership.create({ data: { id: randomUUID(), organizationId, userId: actor.userId, role: 'OWNER', scopeMode: 'ALL_ESTABLISHMENTS' } });
  }, 60000);

  afterEach(async () => {
    if (!prisma || !organizationId) return;
    const [organization, subscriptions] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId }, select: { status: true } }),
      prisma.subscription.findMany({
        where: { organizationId },
        orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
        select: { status: true, startsAt: true, endsAt: true, planVersion: { select: { planCode: true, version: true, status: true } } },
      }),
    ]);
    console.error('[inventory-fixture-state]', JSON.stringify({ organizationStatus: organization?.status ?? null, subscriptions }));
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: actor.userId } });
    await prisma.user.deleteMany({ where: { id: restrictedActor.userId } });
    await prisma.$disconnect();
  });

  it('records a positive movement and reconstructs the tenant-scoped balance', async () => {
    const stock = await createStockFixture('positive');
    const created = await movements.create(actor, organizationId, {
      establishmentId,
      ...stock,
      movementType: 'RECEIPT_IN',
      sourceType: 'MANUAL',
      quantity: '5',
      reason: 'Opening balance',
    }, 'inventory-opening-1');

    const createdId = (created as { id: string }).id;
    expect(created).toMatchObject({ organizationId, ...stock, quantityDelta: '5.000000' });
    await expect(prisma.inventoryBalance.findUniqueOrThrow({ where: { organizationId_warehouseId_itemId: { organizationId, ...stock } } }).then((balance) => balance.quantity.toFixed(6))).resolves.toBe('5.000000');
    await expect(prisma.inventoryMovement.count({ where: { organizationId, id: createdId } })).resolves.toBe(1);
    await expect(prisma.auditEvent.count({ where: { organizationId, targetType: 'InventoryMovement', targetId: createdId } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { organizationId, aggregateType: 'InventoryMovement', aggregateId: createdId } })).resolves.toBe(1);
  });

  it('is idempotent and refuses an output that would make the balance negative', async () => {
    const stock = await createStockFixture('idempotency');
    const input = {
      establishmentId,
      warehouseId: stock.warehouseId,
      itemId: stock.itemId,
      movementType: 'RECEIPT_IN',
      sourceType: 'MANUAL',
      quantity: '5',
      reason: 'Opening balance',
    } as const;
    const first = await movements.create(actor, organizationId, input, 'inventory-idempotency-seed');
    const replay = await movements.create(actor, organizationId, input, 'inventory-idempotency-seed');
    expect(replay).toEqual(first);
    expect(replay).toMatchObject({ quantityDelta: '5.000000' });
    await expect(movements.create(actor, organizationId, { ...input, quantity: '6' }, 'inventory-idempotency-seed')).rejects.toThrow(/different inventory movement payload/i);
    await expect(movements.create(actor, organizationId, { establishmentId, ...stock, movementType: 'SALE_OUT', sourceType: 'SALE', quantity: '6' }, 'inventory-sale-too-large')).rejects.toThrow('Insufficient inventory');
    await expect(prisma.inventoryMovement.count({ where: { organizationId, warehouseId: stock.warehouseId, itemId: stock.itemId } })).resolves.toBe(1);
  });

  it('serializes concurrent outputs on one warehouse and item', async () => {
    const stock = await createStockFixture('concurrency');
    await movements.create(actor, organizationId, { establishmentId, ...stock, movementType: 'RECEIPT_IN', sourceType: 'MANUAL', quantity: '5' }, 'inventory-race-funding');
    const responses = await Promise.allSettled([
      movements.create(actor, organizationId, { establishmentId, ...stock, movementType: 'SALE_OUT', sourceType: 'SALE', quantity: '3' }, 'inventory-sale-race-1'),
      movements.create(actor, organizationId, { establishmentId, ...stock, movementType: 'SALE_OUT', sourceType: 'SALE', quantity: '3' }, 'inventory-sale-race-2'),
    ]);
    expect(responses.filter((response) => response.status === 'fulfilled')).toHaveLength(1);
    expect(responses.filter((response) => response.status === 'rejected')).toHaveLength(1);
    await expect(prisma.inventoryBalance.findUniqueOrThrow({ where: { organizationId_warehouseId_itemId: { organizationId, warehouseId: stock.warehouseId, itemId: stock.itemId } } }).then((balance) => balance.quantity.toFixed(6))).resolves.toBe('2.000000');
  });

  it('rejects cross-tenant references before writing a ledger row', async () => {
    const otherOrganizationId = randomUUID();
    const businessType = await prisma.businessType.findFirstOrThrow({ select: { code: true } });
    await prisma.organization.create({ data: { id: otherOrganizationId, businessTypeCode: businessType.code, name: 'Other tenant', handle: `inventory-other-${Date.now()}`, defaultCurrency: 'EUR' } });
    await expect(movements.create(actor, organizationId, { establishmentId, warehouseId, itemId, movementType: 'RECEIPT_IN', sourceType: 'MANUAL', quantity: '1' }, 'inventory-cross-tenant')).resolves.toBeDefined();
    await expect(movements.create(actor, otherOrganizationId, { establishmentId, warehouseId, itemId, movementType: 'RECEIPT_IN', sourceType: 'MANUAL', quantity: '1' }, 'inventory-cross-tenant-other')).rejects.toThrow();
    await prisma.organization.delete({ where: { id: otherOrganizationId } });
  });

  it('prevents a source line from being posted twice with another idempotency key', async () => {
    const sourceId = randomUUID();
    const sourceLineId = randomUUID();
    const input = { establishmentId, warehouseId, itemId, movementType: 'ADJUSTMENT_IN' as const, sourceType: 'HISTORICAL_IMPORT' as const, quantity: '1', sourceId, sourceLineId };
    await expect(movements.create(actor, organizationId, input, 'inventory-source-1')).resolves.toBeDefined();
    await expect(movements.create(actor, organizationId, input, 'inventory-source-2')).rejects.toThrow();
  });

  it('rejects unilateral transfer movements from the generic movement command', async () => {
    await expect(movements.create(actor, organizationId, { establishmentId, warehouseId, itemId, movementType: 'TRANSFER_OUT', sourceType: 'TRANSFER', quantity: '1' }, 'inventory-unilateral-transfer')).rejects.toThrow(/atomically through the transfer endpoint/i);
    await expect(prisma.inventoryMovement.count({ where: { organizationId, idempotencyKey: 'inventory-unilateral-transfer' } })).resolves.toBe(0);
  });

  it('moves stock atomically with two linked append-only movements and idempotent replay', async () => {
    const source = await createStockFixture('transfer-source');
    const destination = await createStockFixture('transfer-destination');
    await movements.create(actor, organizationId, { establishmentId, ...source, movementType: 'RECEIPT_IN', sourceType: 'MANUAL', quantity: '5' }, 'inventory-transfer-funding');
    const transferInput = { fromWarehouseId: source.warehouseId, toWarehouseId: destination.warehouseId, itemId: source.itemId, quantity: '1', reason: 'Rebalancing' };
    const result = await transfers.create(actor, organizationId, transferInput, 'inventory-transfer-1');
    expect(result).toMatchObject({ outgoing: { warehouseId: source.warehouseId, quantityDelta: '-1.000000' }, incoming: { warehouseId: destination.warehouseId, quantityDelta: '1.000000' } });
    await expect(prisma.inventoryMovement.count({ where: { organizationId, transferId: (result as { transferId: string }).transferId } })).resolves.toBe(2);
    const sourceBalance = await prisma.inventoryBalance.findUniqueOrThrow({ where: { organizationId_warehouseId_itemId: { organizationId, warehouseId: source.warehouseId, itemId: source.itemId } } });
    const destinationBalance = await prisma.inventoryBalance.findUniqueOrThrow({ where: { organizationId_warehouseId_itemId: { organizationId, warehouseId: destination.warehouseId, itemId: source.itemId } } });
    expect(sourceBalance.quantity.toFixed(6)).toBe('4.000000');
    expect(destinationBalance.quantity.toFixed(6)).toBe('1.000000');
    await expect(balances.reconstruct(actor, organizationId, establishmentId, source.warehouseId, source.itemId)).resolves.toMatchObject({ items: [{ warehouseId: source.warehouseId, itemId: source.itemId, quantity: '4.000000' }] });
    await expect(balances.reconstruct(actor, organizationId, establishmentId, destination.warehouseId, source.itemId)).resolves.toMatchObject({ items: [{ warehouseId: destination.warehouseId, itemId: source.itemId, quantity: '1.000000' }] });
    await expect(transfers.create(actor, organizationId, transferInput, 'inventory-transfer-1')).resolves.toEqual(result);
    await expect(transfers.create(actor, organizationId, { ...transferInput, quantity: '2' }, 'inventory-transfer-1')).rejects.toThrow(/different inventory transfer payload/i);
    await expect(transfers.create(actor, organizationId, { ...transferInput, fromWarehouseId: destination.warehouseId, toWarehouseId: source.warehouseId }, 'inventory-transfer-1')).rejects.toThrow(/different inventory transfer payload/i);
    const reconciliationInput = { establishmentId, warehouseId: source.warehouseId, itemId: source.itemId, observedQuantity: '4' };
    const reconciliation = await reconciliations.reconcile(actor, organizationId, reconciliationInput, 'inventory-reconciliation-1');
    expect(reconciliation).toMatchObject({ organizationId, establishmentId, warehouseId: source.warehouseId, itemId: source.itemId, ledgerQuantity: '4.000000', observedQuantity: '4.000000', delta: '0.000000', matched: true });
    await expect(reconciliations.reconcile(actor, organizationId, reconciliationInput, 'inventory-reconciliation-1')).resolves.toEqual(reconciliation);
    await expect(reconciliations.reconcile(actor, organizationId, { ...reconciliationInput, observedQuantity: '5' }, 'inventory-reconciliation-1')).rejects.toThrow(/different inventory reconciliation payload/i);

    const restrictedEstablishmentId = randomUUID();
    const restrictedMembershipId = randomUUID();
    const restrictedEmail = `inventory-replay-${restrictedActor.userId}@example.com`;
    await prisma.establishment.create({ data: { id: restrictedEstablishmentId, organizationId, code: 'REPLAY-SCOPE', name: 'Replay scope', type: 'BRANCH' } });
    await prisma.user.create({ data: { id: restrictedActor.userId, email: restrictedEmail, normalizedEmail: restrictedEmail, passwordHash: 'not-used', firstName: 'Restricted', lastName: 'Replay' } });
    await prisma.membership.create({ data: { id: restrictedMembershipId, organizationId, userId: restrictedActor.userId, role: 'OPERATIONS', scopeMode: 'SELECTED_ESTABLISHMENTS', scopeLinks: { create: [{ establishmentId: restrictedEstablishmentId }] } } });
    await expect(transfers.create(restrictedActor, organizationId, transferInput, 'inventory-transfer-1')).rejects.toThrow(/establishment|access/i);
  });

  it('does not allow application updates or deletes on the append-only movement ledger', async () => {
    const stock = await createStockFixture('immutable');
    const created = await movements.create(actor, organizationId, { establishmentId, ...stock, movementType: 'RECEIPT_IN', sourceType: 'MANUAL', quantity: '1' }, 'inventory-immutable-movement');
    const row = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: (created as { id: string }).id } });
    await expect(prisma.inventoryMovement.update({ where: { id: row.id }, data: { reason: 'tampered' } })).rejects.toThrow();
    await expect(prisma.inventoryMovement.delete({ where: { id: row.id } })).rejects.toThrow();
  });

  async function createStockFixture(label: string): Promise<{ warehouseId: string; itemId: string }> {
    const fixtureWarehouseId = randomUUID();
    const fixtureItemId = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    await prisma.warehouse.create({ data: { id: fixtureWarehouseId, organizationId, establishmentId, code: `${label}-${suffix}`, name: `${label} warehouse` } });
    await prisma.item.create({ data: { id: fixtureItemId, organizationId, type: 'PRODUCT', name: `${label} item ${suffix}`, unit: 'piece', referencePrice: '1', currency: 'EUR', trackInventory: true } });
    return { warehouseId: fixtureWarehouseId, itemId: fixtureItemId };
  }
});
