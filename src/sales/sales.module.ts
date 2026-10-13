import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../events/event.module.js';
import { EntitlementsModule } from '../entitlements/entitlements.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';

@Module({
  imports: [AuthModule, EventModule, EntitlementsModule, TenancyModule],
})
export class SalesModule {}
