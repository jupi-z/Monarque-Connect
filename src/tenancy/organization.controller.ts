import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CreateEstablishmentDto, CreateOrganizationDto, OrganizationIdParam, UpdateOrganizationDto } from './organization.dto.js';
import { UpdateMembershipDto } from './membership.dto.js';
import { OrganizationService } from './organization.service.js';

@Controller('organizations')
@UseGuards(AuthGuard)
export class OrganizationController {
  constructor(private readonly organizations: OrganizationService) {}

  @Get()
  async list(@CurrentPrincipal() principal: AuthPrincipal): Promise<unknown> { return this.organizations.list(principal); }

  @Post()
  async create(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: CreateOrganizationDto): Promise<unknown> { return this.organizations.create(principal, input); }

  @Get(':organizationId')
  async get(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationIdParam): Promise<unknown> { return this.organizations.get(principal, params.organizationId); }

  @Patch(':organizationId')
  async update(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationIdParam, @Body() input: UpdateOrganizationDto): Promise<unknown> { return this.organizations.update(principal, params.organizationId, input); }

  @Get(':organizationId/establishments')
  async establishments(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationIdParam): Promise<unknown> { return this.organizations.establishments(principal, params.organizationId); }

  @Post(':organizationId/establishments')
  async createEstablishment(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationIdParam, @Body() input: CreateEstablishmentDto): Promise<unknown> { return this.organizations.createEstablishment(principal, params.organizationId, input); }

  @Get(':organizationId/members')
  async members(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationIdParam): Promise<unknown> { return this.organizations.members(principal, params.organizationId); }

  @Patch(':organizationId/members/:membershipId')
  async updateMember(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Param('membershipId') membershipId: string, @Body() input: UpdateMembershipDto): Promise<unknown> { return this.organizations.updateMember(principal, organizationId, membershipId, input); }

  @Get(':organizationId/capabilities')
  async capabilities(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationIdParam): Promise<unknown> { return this.organizations.capabilities(principal, params.organizationId); }
}
