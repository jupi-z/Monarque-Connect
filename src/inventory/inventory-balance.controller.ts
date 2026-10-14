import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { InventoryBalanceService } from './inventory-balance.service.js';
import { InventoryListQuery } from './inventory.dto.js';

@Controller('organizations/:organizationId/inventory/balances')
@UseGuards(AuthGuard)
export class InventoryBalanceController {
  constructor(private readonly balances: InventoryBalanceService) {}

  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Query() query: InventoryListQuery): Promise<unknown> {
    return this.balances.list(principal, organizationId, query);
  }
}
