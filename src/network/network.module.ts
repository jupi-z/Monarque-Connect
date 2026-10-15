import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../events/event.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { EntitlementsModule } from '../entitlements/entitlements.module.js';
import { NetworkProfileController } from './profile.controller.js';
import { NetworkProfileService } from './profile.service.js';
import { NetworkDiscoveryService } from './discovery.service.js';
import { NetworkTrustService } from './trust.service.js';
import { NetworkConnectionController } from './connection.controller.js';
import { ConnectionRequestService } from './connection.service.js';
import { NetworkInquiryController } from './inquiry.controller.js';
import { NetworkInquiryService } from './inquiry.service.js';
import { NetworkTrustCommandController } from './network-trust-command.controller.js';
import { NetworkTrustCommandService } from './network-trust-command.service.js';

@Module({
  imports: [AuthModule, EventModule, TenancyModule, EntitlementsModule],
  controllers: [NetworkProfileController, NetworkConnectionController, NetworkInquiryController, NetworkTrustCommandController],
  providers: [NetworkProfileService, NetworkDiscoveryService, NetworkTrustService, NetworkTrustCommandService, ConnectionRequestService, NetworkInquiryService],
})
export class NetworkModule {}
