import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../events/event.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { BillingCatalogController, BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';

@Module({
  imports: [AuthModule, EventModule, TenancyModule],
  controllers: [BillingCatalogController, BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
