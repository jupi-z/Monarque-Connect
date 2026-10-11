import { Module } from '@nestjs/common';
import { EventModule } from '../events/event.module.js';
import { SubscriptionService } from './subscription.service.js';
import { EffectiveEntitlementsService } from './effective-entitlements.service.js';
import { QuotaService } from './quota.service.js';

@Module({
  imports: [EventModule],
  providers: [SubscriptionService, EffectiveEntitlementsService, QuotaService],
  exports: [SubscriptionService, EffectiveEntitlementsService, QuotaService],
})
export class EntitlementsModule {}
