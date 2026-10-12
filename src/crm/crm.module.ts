import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../events/event.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { LeadController } from './lead.controller.js';
import { LeadService } from './lead.service.js';
import { OpportunityController } from './opportunity.controller.js';
import { OpportunityService } from './opportunity.service.js';

@Module({
  imports: [AuthModule, EventModule, TenancyModule],
  controllers: [LeadController, OpportunityController],
  providers: [LeadService, OpportunityService],
})
export class CrmModule {}
