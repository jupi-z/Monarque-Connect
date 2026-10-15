import { Module } from '@nestjs/common';
import { EventModule } from '../events/event.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { SubscriptionService } from './subscription.service.js';
import { EffectiveEntitlementsService } from './effective-entitlements.service.js';
import { QuotaService } from './quota.service.js';
import { EntitlementOverrideService } from './entitlement-override.service.js';
import { PlatformAuthorizationService } from './platform-authorization.service.js';
import { PlatformEntitlementController } from './platform-entitlement.controller.js';

@Module({
  imports: [EventModule, AuthModule],
  controllers: [PlatformEntitlementController],
  providers: [SubscriptionService, EffectiveEntitlementsService, QuotaService, EntitlementOverrideService, PlatformAuthorizationService],
  exports: [SubscriptionService, EffectiveEntitlementsService, QuotaService, EntitlementOverrideService, PlatformAuthorizationService],
})
export class EntitlementsModule {}
