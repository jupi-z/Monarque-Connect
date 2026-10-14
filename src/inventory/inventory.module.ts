import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../events/event.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { InventoryBalanceService } from './inventory-balance.service.js';
import { InventoryMovementService } from './inventory-movement.service.js';
import { InventoryTransferService } from './inventory-transfer.service.js';
import { GoodsReceiptInventoryController } from './goods-receipt-inventory.controller.js';
import { GoodsReceiptInventoryService } from './goods-receipt-inventory.service.js';

@Module({ imports: [AuthModule, EventModule, TenancyModule], controllers: [GoodsReceiptInventoryController], providers: [InventoryBalanceService, InventoryMovementService, InventoryTransferService, GoodsReceiptInventoryService], exports: [InventoryBalanceService, InventoryMovementService, InventoryTransferService, GoodsReceiptInventoryService] })
export class InventoryModule {}
