import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { GoodsReceiptInventoryAssignmentDto, GoodsReceiptInventoryImportDto, PendingGoodsReceiptInventoryQuery } from './goods-receipt-inventory.dto.js';
import { GoodsReceiptInventoryService } from './goods-receipt-inventory.service.js';

@Controller('organizations/:organizationId/inventory/goods-receipts')
@UseGuards(AuthGuard)
export class GoodsReceiptInventoryController {
  constructor(private readonly inventory: GoodsReceiptInventoryService) {}

  @Get('pending')
  listPending(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Query() query: PendingGoodsReceiptInventoryQuery): Promise<unknown> { return this.inventory.listPending(principal, organizationId, query); }

  @Post(':receiptId/assignment')
  @HttpCode(200)
  assign(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Param('receiptId') receiptId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: GoodsReceiptInventoryAssignmentDto): Promise<unknown> { return this.inventory.assign(principal, organizationId, receiptId, input, key); }

  @Post(':receiptId/import')
  @HttpCode(200)
  importHistorical(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Param('receiptId') receiptId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: GoodsReceiptInventoryImportDto): Promise<unknown> { return this.inventory.importHistorical(principal, organizationId, receiptId, input, key); }
}
