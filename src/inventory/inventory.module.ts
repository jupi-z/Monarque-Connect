import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../events/event.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { InventoryBalanceService } from './inventory-balance.service.js';
import { InventoryMovementService } from './inventory-movement.service.js';
import { InventoryTransferService } from './inventory-transfer.service.js';

@Module({ imports: [AuthModule, EventModule, TenancyModule], providers: [InventoryBalanceService, InventoryMovementService, InventoryTransferService], exports: [InventoryBalanceService, InventoryMovementService, InventoryTransferService] })
export class InventoryModule {}
