import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../events/event.module.js';
import { EntitlementsModule } from '../entitlements/entitlements.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { BillingCatalogController, BillingController, BillingProviderController, PlatformBillingController } from './billing.controller.js';
import { BillingProviderService } from './billing-provider.service.js';
import { BillingLifecycleService } from './billing-lifecycle.service.js';
import { BillingService } from './billing.service.js';
import { BillingAdminService } from './billing-admin.service.js';

@Module({
  imports: [AuthModule, EventModule, EntitlementsModule, TenancyModule],
  controllers: [BillingCatalogController, BillingController, BillingProviderController, PlatformBillingController],
  providers: [BillingService, BillingProviderService, BillingLifecycleService, BillingAdminService],
  exports: [BillingService, BillingProviderService, BillingLifecycleService, BillingAdminService],
})
export class BillingModule {}
