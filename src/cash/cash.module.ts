import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../events/event.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { CashAccountService } from './cash-account.service.js';
import { CashMovementService } from './cash-movement.service.js';
import { CashAccountController, CashMovementController, CashTransferController } from './cash.controller.js';

@Module({ imports: [AuthModule, EventModule, TenancyModule], controllers: [CashAccountController, CashMovementController, CashTransferController], providers: [CashAccountService, CashMovementService], exports: [CashAccountService, CashMovementService] })
export class CashModule {}
