import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EntitlementsModule } from '../entitlements/entitlements.module.js';
import { EventModule } from '../events/event.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { CommercialPriceService } from './commercial-price.service.js';
import { FxRateController } from './fx-rate.controller.js';
import { FxRateService } from './fx-rate.service.js';
import { PricingPolicyController } from './pricing-policy.controller.js';
import { PricingPolicyService } from './pricing-policy.service.js';
import { PricingQuoteController } from './pricing-quote.controller.js';
import { PricingQuoteService } from './pricing-quote.service.js';

@Module({
  imports: [AuthModule, EntitlementsModule, EventModule, TenancyModule],
  controllers: [FxRateController, PricingPolicyController, PricingQuoteController],
  providers: [CommercialPriceService, FxRateService, PricingPolicyService, PricingQuoteService],
  exports: [CommercialPriceService],
})
export class PricingModule {}
