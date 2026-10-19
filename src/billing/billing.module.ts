import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../events/event.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { BillingCatalogController, BillingController, BillingProviderController } from './billing.controller.js';
import { BillingProviderService } from './billing-provider.service.js';
import { BillingService } from './billing.service.js';

@Module({
  imports: [AuthModule, EventModule, TenancyModule],
  controllers: [BillingCatalogController, BillingController, BillingProviderController],
  providers: [BillingService, BillingProviderService],
  exports: [BillingService, BillingProviderService],
})
export class BillingModule {}
