import { Body, Controller, Headers, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { InventoryReconciliationService } from './inventory-reconciliation.service.js';
import { ReconcileInventoryDto } from './inventory.dto.js';

@Controller('organizations/:organizationId/inventory/reconciliation')
@UseGuards(AuthGuard)
export class InventoryReconciliationController {
  constructor(private readonly reconciliations: InventoryReconciliationService) {}

  @Post()
  @HttpCode(200)
  reconcile(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: ReconcileInventoryDto): Promise<unknown> {
    return this.reconciliations.reconcile(principal, organizationId, input, key);
  }
}
