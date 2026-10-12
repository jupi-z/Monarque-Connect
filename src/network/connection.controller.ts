import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { ConnectionRequestService } from './connection.service.js';
import { ConnectionRequestListQuery, ConnectionRequestParams, CreateConnectionRequestDto, OrganizationConnectionParams, UpdateConnectionRequestDto } from './connection.dto.js';

@Controller()
@UseGuards(AuthGuard)
export class NetworkConnectionController {
  constructor(private readonly connections: ConnectionRequestService) {}

  @Post('organizations/:organizationId/connection-requests')
  async create(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationConnectionParams, @Body() input: CreateConnectionRequestDto): Promise<unknown> {
    return this.connections.create(principal, params.organizationId, input);
  }

  @Get('organizations/:organizationId/connection-requests')
  async list(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationConnectionParams, @Query() query: ConnectionRequestListQuery): Promise<unknown> {
    return this.connections.list(principal, params.organizationId, query);
  }

  @Patch('organizations/:organizationId/connection-requests/:connectionRequestId')
  async update(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: ConnectionRequestParams, @Body() input: UpdateConnectionRequestDto): Promise<unknown> {
    return this.connections.updateStatus(principal, params.organizationId, params.connectionRequestId, input.status);
  }
}
