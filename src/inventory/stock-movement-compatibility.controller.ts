import { Body, Controller, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CreateInventoryMovementDto } from './inventory.dto.js';
import { InventoryMovementService } from './inventory-movement.service.js';

@Controller('organizations/:organizationId/stock-movements')
@UseGuards(AuthGuard)
export class StockMovementCompatibilityController {
  constructor(private readonly movements: InventoryMovementService) {}

  @Post()
  createLegacy(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: CreateInventoryMovementDto): Promise<unknown> {
    return this.movements.create(principal, organizationId, { establishmentId: input.establishmentId, warehouseId: input.warehouseId, itemId: input.itemId, movementType: input.movementType, sourceType: 'MANUAL', quantity: input.quantityDelta, reason: input.reason, occurredAt: input.occurredAt }, key ?? '');
  }
}
