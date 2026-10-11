import { Module } from '@nestjs/common';
import { EventModule } from '../events/event.module.js';
import { SubscriptionService } from './subscription.service.js';

@Module({
  imports: [EventModule],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class EntitlementsModule {}
