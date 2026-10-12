import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CreateWarehouseDto, OrganizationEstablishmentParams, UpdateWarehouseDto, WarehouseListQuery, WarehouseParams } from './warehouse.dto.js';
import { WarehouseService } from './warehouse.service.js';

@Controller('organizations/:organizationId/establishments/:establishmentId/warehouses')
@UseGuards(AuthGuard)
export class WarehouseController {
  constructor(private readonly warehouses: WarehouseService) {}

  @Get()
  async list(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationEstablishmentParams, @Query() query: WarehouseListQuery): Promise<unknown> { return this.warehouses.list(principal, params.organizationId, params.establishmentId, query); }

  @Post()
  async create(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationEstablishmentParams, @Body() input: CreateWarehouseDto): Promise<unknown> { return this.warehouses.create(principal, params.organizationId, params.establishmentId, input); }

  @Get(':warehouseId')
  async get(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: WarehouseParams): Promise<unknown> { return this.warehouses.get(principal, params.organizationId, params.establishmentId, params.warehouseId); }

  @Patch(':warehouseId')
  async update(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: WarehouseParams, @Body() input: UpdateWarehouseDto): Promise<unknown> { return this.warehouses.update(principal, params.organizationId, params.establishmentId, params.warehouseId, input); }

  @Post(':warehouseId/deactivate')
  @HttpCode(200)
  async deactivate(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: WarehouseParams): Promise<unknown> { return this.warehouses.setActive(principal, params.organizationId, params.establishmentId, params.warehouseId, false); }

  @Post(':warehouseId/reactivate')
  @HttpCode(200)
  async reactivate(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: WarehouseParams): Promise<unknown> { return this.warehouses.setActive(principal, params.organizationId, params.establishmentId, params.warehouseId, true); }
}
