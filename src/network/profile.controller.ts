import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { NetworkProfileService } from './profile.service.js';
import { OrganizationNetworkProfileParams, PublicNetworkOrganizationParams, UpdateOrganizationNetworkProfileDto } from './profile.dto.js';

@Controller()
export class NetworkProfileController {
  constructor(private readonly profiles: NetworkProfileService) {}

  @Get('organizations/:organizationId/network-profile')
  @UseGuards(AuthGuard)
  async get(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationNetworkProfileParams): Promise<unknown> { return this.profiles.get(principal, params.organizationId); }

  @Patch('organizations/:organizationId/network-profile')
  @UseGuards(AuthGuard)
  async update(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationNetworkProfileParams, @Body() input: UpdateOrganizationNetworkProfileDto): Promise<unknown> { return this.profiles.update(principal, params.organizationId, input); }

  @Get('network/organizations/:organizationId')
  async getPublic(@Param() params: PublicNetworkOrganizationParams): Promise<unknown> { return this.profiles.getPublic(params.organizationId); }
}
