import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../events/event.module.js';
import { AuthorizationService } from './authorization.service.js';
import { OrganizationController } from './organization.controller.js';
import { OrganizationService } from './organization.service.js';
import { InvitationController } from './invitation.controller.js';
import { InvitationService } from './invitation.service.js';

@Module({
  imports: [EventModule, AuthModule],
  controllers: [OrganizationController, InvitationController],
  providers: [AuthorizationService, OrganizationService, InvitationService],
  exports: [AuthorizationService, OrganizationService, InvitationService],
})
export class TenancyModule {}
