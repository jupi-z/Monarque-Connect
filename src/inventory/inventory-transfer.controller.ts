import { Body, Controller, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CreateInventoryTransferHttpDto, type InventoryTransferCommand } from './inventory.dto.js';
import { InventoryTransferService } from './inventory-transfer.service.js';

@Controller('organizations/:organizationId/inventory/transfers')
@UseGuards(AuthGuard)
export class InventoryTransferController {
  constructor(private readonly transfers: InventoryTransferService) {}

  @Post()
  create(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: CreateInventoryTransferHttpDto): Promise<unknown> {
    const command: InventoryTransferCommand = { fromWarehouseId: input.sourceWarehouseId, toWarehouseId: input.destinationWarehouseId, itemId: input.itemId, quantity: input.quantity, reason: input.reason, occurredAt: input.occurredAt };
    return this.transfers.create(principal, organizationId, command, key ?? '');
  }
}
