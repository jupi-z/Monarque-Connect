import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';
import { exportPKCS8, exportSPKI } from 'jose';
import { Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { InventoryMovementService } from '../../src/inventory/inventory-movement.service.js';
import { InventoryTransferService } from '../../src/inventory/inventory-transfer.service.js';
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
  const actor = { userId: randomUUID(), sessionId: randomUUID() };

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

    await seedReferenceData(prisma);

    const businessType = await prisma.businessType.findFirstOrThrow({ select: { code: true } });
    organizationId = randomUUID();
    establishmentId = randomUUID();
    warehouseId = randomUUID();
    itemId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, businessTypeCode: businessType.code, name: 'Inventory ledger test', handle: `inventory-ledger-${Date.now()}`, defaultCurrency: 'EUR' } });
    const business = await prisma.planVersion.findUniqueOrThrow({ where: { planCode_version: { planCode: 'BUSINESS', version: 1 } }, include: { modules: true } });
    await prisma.subscription.create({ data: { id: randomUUID(), organizationId, planVersionId: business.id, status: 'ACTIVE', startsAt: new Date() } });
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

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: actor.userId } });
    await prisma.$disconnect();
  });

  it('records a positive movement and reconstructs the tenant-scoped balance', async () => {
    const created = await movements.create(actor, organizationId, {
      establishmentId,
      warehouseId,
      itemId,
      movementType: 'RECEIPT_IN',
      sourceType: 'MANUAL',
      quantity: '5',
      reason: 'Opening balance',
    }, 'inventory-opening-1');

    expect(created).toMatchObject({ organizationId, warehouseId, itemId, quantityDelta: '5.000000' });
    await expect(prisma.inventoryBalance.findUniqueOrThrow({ where: { organizationId_warehouseId_itemId: { organizationId, warehouseId, itemId } } })).resolves.toMatchObject({ quantity: new Prisma.Decimal('5.000000') });
    await expect(prisma.inventoryMovement.count({ where: { organizationId, warehouseId, itemId } })).resolves.toBe(1);
    await expect(prisma.auditEvent.count({ where: { organizationId, targetType: 'InventoryMovement' } })).resolves.toBe(1);
    await expect(prisma.outboxEvent.count({ where: { organizationId, aggregateType: 'InventoryMovement' } })).resolves.toBe(1);
  });

  it('is idempotent and refuses an output that would make the balance negative', async () => {
    const replay = await movements.create(actor, organizationId, {
      establishmentId,
      warehouseId,
      itemId,
      movementType: 'RECEIPT_IN',
      sourceType: 'MANUAL',
      quantity: '5',
      reason: 'Opening balance',
    }, 'inventory-opening-1');
    expect(replay).toMatchObject({ quantityDelta: '5.000000' });
    await expect(movements.create(actor, organizationId, { establishmentId, warehouseId, itemId, movementType: 'SALE_OUT', sourceType: 'SALE', quantity: '6' }, 'inventory-sale-too-large')).rejects.toThrow('Insufficient inventory');
    await expect(prisma.inventoryMovement.count({ where: { organizationId, warehouseId, itemId } })).resolves.toBe(1);
  });

  it('serializes concurrent outputs on one warehouse and item', async () => {
    const responses = await Promise.allSettled([
      movements.create(actor, organizationId, { establishmentId, warehouseId, itemId, movementType: 'SALE_OUT', sourceType: 'SALE', quantity: '3' }, 'inventory-sale-race-1'),
      movements.create(actor, organizationId, { establishmentId, warehouseId, itemId, movementType: 'SALE_OUT', sourceType: 'SALE', quantity: '3' }, 'inventory-sale-race-2'),
    ]);
    expect(responses.filter((response) => response.status === 'fulfilled')).toHaveLength(1);
    expect(responses.filter((response) => response.status === 'rejected')).toHaveLength(1);
    await expect(prisma.inventoryBalance.findUniqueOrThrow({ where: { organizationId_warehouseId_itemId: { organizationId, warehouseId, itemId } } })).resolves.toMatchObject({ quantity: new Prisma.Decimal('2.000000') });
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

  it('moves stock atomically with two linked append-only movements and idempotent replay', async () => {
    const result = await transfers.create(actor, organizationId, { fromWarehouseId: warehouseId, toWarehouseId: destinationWarehouseId, itemId, quantity: '1', reason: 'Rebalancing' }, 'inventory-transfer-1');
    expect(result).toMatchObject({ outgoing: { warehouseId, quantityDelta: '-1.000000' }, incoming: { warehouseId: destinationWarehouseId, quantityDelta: '1.000000' } });
    await expect(prisma.inventoryMovement.count({ where: { organizationId, transferId: (result as { transferId: string }).transferId } })).resolves.toBe(2);
    const sourceBalance = await prisma.inventoryBalance.findUniqueOrThrow({ where: { organizationId_warehouseId_itemId: { organizationId, warehouseId, itemId } } });
    const destinationBalance = await prisma.inventoryBalance.findUniqueOrThrow({ where: { organizationId_warehouseId_itemId: { organizationId, warehouseId: destinationWarehouseId, itemId } } });
    expect(sourceBalance.quantity.toFixed(6)).toBe('3.000000');
    expect(destinationBalance.quantity.toFixed(6)).toBe('1.000000');
    await expect(transfers.create(actor, organizationId, { fromWarehouseId: warehouseId, toWarehouseId: destinationWarehouseId, itemId, quantity: '1', reason: 'Rebalancing' }, 'inventory-transfer-1')).resolves.toEqual(result);
  });

  it('does not allow application updates or deletes on the append-only movement ledger', async () => {
    const row = await prisma.inventoryMovement.findFirstOrThrow({ where: { organizationId, warehouseId, itemId } });
    await expect(prisma.inventoryMovement.update({ where: { id: row.id }, data: { reason: 'tampered' } })).rejects.toThrow();
    await expect(prisma.inventoryMovement.delete({ where: { id: row.id } })).rejects.toThrow();
  });
});
