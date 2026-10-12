import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CreateOpportunityDto, OpportunityListQuery, OpportunityStatusParams, OrganizationOpportunityParams, TransitionOpportunityDto } from './opportunity.dto.js';
import { OpportunityService } from './opportunity.service.js';

@Controller('organizations/:organizationId/opportunities')
@UseGuards(AuthGuard)
export class OpportunityController {
  constructor(private readonly opportunities: OpportunityService) {}

  @Get()
  async list(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationOpportunityParams, @Query() query: OpportunityListQuery): Promise<unknown> { return this.opportunities.list(principal, params.organizationId, query); }

  @Post()
  async create(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationOpportunityParams, @Body() input: CreateOpportunityDto): Promise<unknown> { return this.opportunities.create(principal, params.organizationId, input); }

  @Post(':opportunityId/status')
  @HttpCode(200)
  async transition(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OpportunityStatusParams, @Body() input: TransitionOpportunityDto): Promise<unknown> { return this.opportunities.transition(principal, params.organizationId, params.opportunityId, input); }
}
