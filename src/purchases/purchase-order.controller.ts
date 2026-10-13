import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CreatePurchaseOrderDto, PurchaseOrderOrganizationParams, PurchaseOrderListQuery, PurchaseOrderParams, UpdatePurchaseOrderDto } from './purchase-order.dto.js';
import { PurchaseOrderService } from './purchase-order.service.js';

@Controller('organizations/:organizationId/purchase-orders')
@UseGuards(AuthGuard)
export class PurchaseOrderController {
  constructor(private readonly orders: PurchaseOrderService) {}
  @Get() list(@CurrentPrincipal() p: AuthPrincipal, @Param() params: PurchaseOrderOrganizationParams, @Query() q: PurchaseOrderListQuery): Promise<unknown> { return this.orders.list(p, params.organizationId, q); }
  @Post() create(@CurrentPrincipal() p: AuthPrincipal, @Param() params: PurchaseOrderOrganizationParams, @Headers('idempotency-key') key: string | undefined, @Body() input: CreatePurchaseOrderDto): Promise<unknown> { return this.orders.create(p, params.organizationId, input, key); }
  @Get(':purchaseOrderId') get(@CurrentPrincipal() p: AuthPrincipal, @Param() params: PurchaseOrderParams): Promise<unknown> { return this.orders.get(p, params.organizationId, params.purchaseOrderId); }
  @Patch(':purchaseOrderId') update(@CurrentPrincipal() p: AuthPrincipal, @Param() params: PurchaseOrderParams, @Headers('idempotency-key') key: string | undefined, @Body() input: UpdatePurchaseOrderDto): Promise<unknown> { return this.orders.update(p, params.organizationId, params.purchaseOrderId, input, key); }
  @Post(':purchaseOrderId/send') @HttpCode(200) send(@CurrentPrincipal() p: AuthPrincipal, @Param() params: PurchaseOrderParams, @Headers('idempotency-key') key: string | undefined): Promise<unknown> { return this.orders.transition(p, params.organizationId, params.purchaseOrderId, 'SENT', key); }
  @Post(':purchaseOrderId/confirm') @HttpCode(200) confirm(@CurrentPrincipal() p: AuthPrincipal, @Param() params: PurchaseOrderParams, @Headers('idempotency-key') key: string | undefined): Promise<unknown> { return this.orders.transition(p, params.organizationId, params.purchaseOrderId, 'CONFIRMED', key); }
  @Post(':purchaseOrderId/cancel') @HttpCode(200) cancel(@CurrentPrincipal() p: AuthPrincipal, @Param() params: PurchaseOrderParams, @Headers('idempotency-key') key: string | undefined): Promise<unknown> { return this.orders.transition(p, params.organizationId, params.purchaseOrderId, 'CANCELLED', key); }
}
