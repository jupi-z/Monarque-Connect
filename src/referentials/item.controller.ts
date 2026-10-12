import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CreateItemDto, ItemListQuery, ItemParams, OrganizationItemParams, UpdateItemDto } from './item.dto.js';
import { ItemService } from './item.service.js';

@Controller('organizations/:organizationId/items')
@UseGuards(AuthGuard)
export class ItemController {
  constructor(private readonly items: ItemService) {}

  @Get()
  async list(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationItemParams, @Query() query: ItemListQuery): Promise<unknown> { return this.items.list(principal, params.organizationId, query); }

  @Post()
  async create(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationItemParams, @Body() input: CreateItemDto): Promise<unknown> { return this.items.create(principal, params.organizationId, input); }

  @Get(':itemId')
  async get(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: ItemParams): Promise<unknown> { return this.items.get(principal, params.organizationId, params.itemId); }

  @Patch(':itemId')
  async update(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: ItemParams, @Body() input: UpdateItemDto): Promise<unknown> { return this.items.update(principal, params.organizationId, params.itemId, input); }

  @Post(':itemId/deactivate')
  @HttpCode(200)
  async deactivate(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: ItemParams): Promise<unknown> { return this.items.setActive(principal, params.organizationId, params.itemId, false); }

  @Post(':itemId/reactivate')
  @HttpCode(200)
  async reactivate(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: ItemParams): Promise<unknown> { return this.items.setActive(principal, params.organizationId, params.itemId, true); }
}
