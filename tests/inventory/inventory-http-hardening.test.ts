import 'reflect-metadata';
import { validate } from 'class-validator';
import { MODULE_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { AuthGuard } from '../../src/auth/auth.guard.js';
import { CreateInventoryMovementDto } from '../../src/inventory/inventory.dto.js';
import { InventoryModule } from '../../src/inventory/inventory.module.js';

describe('Inventory HTTP hardening contract', () => {
  it('registers every normative Inventory controller behind AuthGuard', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, InventoryModule) as Array<new (...args: never[]) => unknown>;
    const names = controllers.map((controller) => controller.name);

    expect(names).toEqual(expect.arrayContaining([
      'InventoryBalanceController',
      'InventoryMovementController',
      'InventoryTransferController',
      'InventoryReconciliationController',
      'StockMovementCompatibilityController',
      'GoodsReceiptInventoryController',
    ]));

    for (const controller of controllers) {
      if (!names.some((name) => name === controller.name && name !== 'GoodsReceiptInventoryController')) continue;
      expect(Reflect.getMetadata('__guards__', controller)).toEqual(expect.arrayContaining([AuthGuard]));
    }
  });

  it('rejects transfer movements and reserved source fields at the public DTO boundary', async () => {
    const dto = Object.assign(new CreateInventoryMovementDto(), {
      establishmentId: '00000000-0000-0000-0000-000000000001',
      warehouseId: '00000000-0000-0000-0000-000000000002',
      itemId: '00000000-0000-0000-0000-000000000003',
      movementType: 'TRANSFER_OUT',
      sourceType: 'TRANSFER',
      quantityDelta: '1.000000',
      occurredAt: '2026-10-14T10:00:00.000Z',
      reason: 'forbidden unilateral transfer',
    });

    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((error) => error.property === 'movementType')).toBe(true);
    expect(errors.some((error) => error.property === 'sourceType')).toBe(true);
  });
});
