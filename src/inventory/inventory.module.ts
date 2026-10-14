import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../events/event.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { InventoryBalanceService } from './inventory-balance.service.js';
import { InventoryMovementService } from './inventory-movement.service.js';
import { InventoryTransferService } from './inventory-transfer.service.js';
import { GoodsReceiptInventoryController } from './goods-receipt-inventory.controller.js';
import { GoodsReceiptInventoryService } from './goods-receipt-inventory.service.js';
import { InventoryBalanceController } from './inventory-balance.controller.js';
import { InventoryMovementController } from './inventory-movement.controller.js';
import { InventoryTransferController } from './inventory-transfer.controller.js';
import { InventoryReconciliationController } from './inventory-reconciliation.controller.js';
import { StockMovementCompatibilityController } from './stock-movement-compatibility.controller.js';
import { InventoryReconciliationService } from './inventory-reconciliation.service.js';

@Module({ imports: [AuthModule, EventModule, TenancyModule], controllers: [GoodsReceiptInventoryController, InventoryBalanceController, InventoryMovementController, InventoryTransferController, InventoryReconciliationController, StockMovementCompatibilityController], providers: [InventoryBalanceService, InventoryMovementService, InventoryTransferService, GoodsReceiptInventoryService, InventoryReconciliationService], exports: [InventoryBalanceService, InventoryMovementService, InventoryTransferService, GoodsReceiptInventoryService, InventoryReconciliationService] })
export class InventoryModule {}
