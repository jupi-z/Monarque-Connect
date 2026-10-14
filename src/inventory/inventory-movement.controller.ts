import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CreateInventoryMovementDto, InventoryListQuery, type InventoryMovementCommand } from './inventory.dto.js';
import { InventoryMovementService } from './inventory-movement.service.js';

@Controller('organizations/:organizationId/inventory/movements')
@UseGuards(AuthGuard)
export class InventoryMovementController {
  constructor(protected readonly movements: InventoryMovementService) {}

  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Query() query: InventoryListQuery): Promise<unknown> {
    return this.movements.list(principal, organizationId, query);
  }

  @Post()
  create(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: CreateInventoryMovementDto): Promise<unknown> {
    return this.movements.create(principal, organizationId, this.toCommand(input), key ?? '');
  }

  private toCommand(input: CreateInventoryMovementDto): InventoryMovementCommand {
    return { establishmentId: input.establishmentId, warehouseId: input.warehouseId, itemId: input.itemId, movementType: input.movementType, sourceType: 'MANUAL', quantity: input.quantityDelta, reason: input.reason, occurredAt: input.occurredAt };
  }
}
