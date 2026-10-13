import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CorrectGoodsReceiptDto, CreateGoodsReceiptDto, GoodsReceiptListQuery, GoodsReceiptOrderParams, GoodsReceiptParams } from './goods-receipt.dto.js';
import { GoodsReceiptService } from './goods-receipt.service.js';

@Controller('organizations/:organizationId/purchase-orders/:purchaseOrderId/receipts')
@UseGuards(AuthGuard)
export class GoodsReceiptController {
  constructor(private readonly receipts: GoodsReceiptService) {}
  @Get() list(@CurrentPrincipal() p: AuthPrincipal, @Param() params: GoodsReceiptOrderParams, @Query() query: GoodsReceiptListQuery): Promise<unknown> { return this.receipts.list(p, params.organizationId, params.purchaseOrderId, query); }
  @Post() create(@CurrentPrincipal() p: AuthPrincipal, @Param() params: GoodsReceiptOrderParams, @Headers('idempotency-key') key: string | undefined, @Body() input: CreateGoodsReceiptDto): Promise<unknown> { return this.receipts.create(p, params.organizationId, params.purchaseOrderId, input, key); }
  @Get(':receiptId') get(@CurrentPrincipal() p: AuthPrincipal, @Param() params: GoodsReceiptParams): Promise<unknown> { return this.receipts.get(p, params.organizationId, params.purchaseOrderId, params.receiptId); }
  @Post(':receiptId/confirm') @HttpCode(200) confirm(@CurrentPrincipal() p: AuthPrincipal, @Param() params: GoodsReceiptParams, @Headers('idempotency-key') key: string | undefined): Promise<unknown> { return this.receipts.confirm(p, params.organizationId, params.purchaseOrderId, params.receiptId, key); }
  @Post(':receiptId/cancel') @HttpCode(200) cancel(@CurrentPrincipal() p: AuthPrincipal, @Param() params: GoodsReceiptParams, @Headers('idempotency-key') key: string | undefined): Promise<unknown> { return this.receipts.cancel(p, params.organizationId, params.purchaseOrderId, params.receiptId, key); }
  @Post(':receiptId/correct') @HttpCode(200) correct(@CurrentPrincipal() p: AuthPrincipal, @Param() params: GoodsReceiptParams, @Headers('idempotency-key') key: string | undefined, @Body() input: CorrectGoodsReceiptDto): Promise<unknown> { return this.receipts.correct(p, params.organizationId, params.purchaseOrderId, params.receiptId, input, key); }
}
