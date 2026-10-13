import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CreateSupplierRFQDto, OrganizationSupplierRfqParams, SupplierRfqListQuery, SupplierRfqParams, UpdateSupplierRFQDto } from './supplier-rfq.dto.js';
import { SupplierRFQService } from './supplier-rfq.service.js';

@Controller('organizations/:organizationId/supplier-rfqs')
@UseGuards(AuthGuard)
export class SupplierRFQController {
  constructor(private readonly rfqs: SupplierRFQService) {}

  @Get()
  async list(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationSupplierRfqParams, @Query() query: SupplierRfqListQuery): Promise<unknown> { return this.rfqs.list(principal, params.organizationId, query); }

  @Post()
  async create(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationSupplierRfqParams, @Headers('idempotency-key') idempotencyKey: string | undefined, @Body() input: CreateSupplierRFQDto): Promise<unknown> { return this.rfqs.create(principal, params.organizationId, input, idempotencyKey); }

  @Get(':supplierRfqId')
  async get(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: SupplierRfqParams): Promise<unknown> { return this.rfqs.get(principal, params.organizationId, params.supplierRfqId); }

  @Patch(':supplierRfqId')
  async update(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: SupplierRfqParams, @Headers('idempotency-key') idempotencyKey: string | undefined, @Body() input: UpdateSupplierRFQDto): Promise<unknown> { return this.rfqs.update(principal, params.organizationId, params.supplierRfqId, input, idempotencyKey); }

  @Post(':supplierRfqId/send')
  @HttpCode(200)
  async send(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: SupplierRfqParams, @Headers('idempotency-key') idempotencyKey: string | undefined): Promise<unknown> { return this.rfqs.transition(principal, params.organizationId, params.supplierRfqId, 'SENT', idempotencyKey); }

  @Post(':supplierRfqId/close')
  @HttpCode(200)
  async close(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: SupplierRfqParams, @Headers('idempotency-key') idempotencyKey: string | undefined): Promise<unknown> { return this.rfqs.transition(principal, params.organizationId, params.supplierRfqId, 'CLOSED', idempotencyKey); }

  @Post(':supplierRfqId/cancel')
  @HttpCode(200)
  async cancel(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: SupplierRfqParams, @Headers('idempotency-key') idempotencyKey: string | undefined): Promise<unknown> { return this.rfqs.transition(principal, params.organizationId, params.supplierRfqId, 'CANCELLED', idempotencyKey); }
}
