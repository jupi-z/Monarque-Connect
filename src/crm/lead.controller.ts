import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CreateLeadDto, LeadListQuery, LeadParams, OrganizationLeadParams, TransitionLeadDto } from './lead.dto.js';
import { LeadService } from './lead.service.js';

@Controller('organizations/:organizationId/leads')
@UseGuards(AuthGuard)
export class LeadController {
  constructor(private readonly leads: LeadService) {}

  @Get()
  async list(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationLeadParams, @Query() query: LeadListQuery): Promise<unknown> { return this.leads.list(principal, params.organizationId, query); }

  @Post()
  async create(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationLeadParams, @Body() input: CreateLeadDto): Promise<unknown> { return this.leads.create(principal, params.organizationId, input); }

  @Post(':leadId/status')
  @HttpCode(200)
  async transition(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: LeadParams, @Body() input: TransitionLeadDto): Promise<unknown> { return this.leads.transition(principal, params.organizationId, params.leadId, input); }
}
