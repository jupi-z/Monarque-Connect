import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CreatePartyDto, OrganizationPartyParams, PartyListQuery, PartyParams, UpdatePartyDto } from './party.dto.js';
import { PartyService } from './party.service.js';

@Controller('organizations/:organizationId/parties')
@UseGuards(AuthGuard)
export class PartyController {
  constructor(private readonly parties: PartyService) {}

  @Get()
  async list(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationPartyParams, @Query() query: PartyListQuery): Promise<unknown> { return this.parties.list(principal, params.organizationId, query); }

  @Post()
  async create(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationPartyParams, @Body() input: CreatePartyDto): Promise<unknown> { return this.parties.create(principal, params.organizationId, input); }

  @Get(':partyId')
  async get(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: PartyParams): Promise<unknown> { return this.parties.get(principal, params.organizationId, params.partyId); }

  @Patch(':partyId')
  async update(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: PartyParams, @Body() input: UpdatePartyDto): Promise<unknown> { return this.parties.update(principal, params.organizationId, params.partyId, input); }

  @Post(':partyId/deactivate')
  async deactivate(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: PartyParams): Promise<unknown> { return this.parties.setActive(principal, params.organizationId, params.partyId, false); }

  @Post(':partyId/reactivate')
  async reactivate(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: PartyParams): Promise<unknown> { return this.parties.setActive(principal, params.organizationId, params.partyId, true); }
}
