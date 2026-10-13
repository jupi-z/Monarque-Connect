import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CreateSalesOrderDto, OrganizationOrderParams, OrderListQuery, OrderParams, UpdateSalesOrderDto } from './order.dto.js';
import { OrderService } from './order.service.js';

@Controller('organizations/:organizationId/orders')
@UseGuards(AuthGuard)
export class OrderController {
  constructor(private readonly orders: OrderService) {}

  @Get()
  async list(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationOrderParams, @Query() query: OrderListQuery): Promise<unknown> { return this.orders.list(principal, params.organizationId, query); }

  @Post()
  async create(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationOrderParams, @Headers('idempotency-key') idempotencyKey: string | undefined, @Body() input: CreateSalesOrderDto): Promise<unknown> { return this.orders.create(principal, params.organizationId, input, idempotencyKey); }

  @Get(':orderId')
  async get(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrderParams): Promise<unknown> { return this.orders.get(principal, params.organizationId, params.orderId); }

  @Patch(':orderId')
  async update(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrderParams, @Headers('idempotency-key') idempotencyKey: string | undefined, @Body() input: UpdateSalesOrderDto): Promise<unknown> { return this.orders.update(principal, params.organizationId, params.orderId, input, idempotencyKey); }

  @Post(':orderId/confirm')
  @HttpCode(200)
  async confirm(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrderParams, @Headers('idempotency-key') idempotencyKey: string | undefined): Promise<unknown> { return this.orders.transition(principal, params.organizationId, params.orderId, 'CONFIRMED', idempotencyKey); }

  @Post(':orderId/cancel')
  @HttpCode(200)
  async cancel(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrderParams, @Headers('idempotency-key') idempotencyKey: string | undefined): Promise<unknown> { return this.orders.transition(principal, params.organizationId, params.orderId, 'CANCELLED', idempotencyKey); }
}
