import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../events/event.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { NetworkProfileController } from './profile.controller.js';
import { NetworkProfileService } from './profile.service.js';

@Module({
  imports: [AuthModule, EventModule, TenancyModule],
  controllers: [NetworkProfileController],
  providers: [NetworkProfileService],
})
export class NetworkModule {}
