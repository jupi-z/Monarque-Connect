import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { InvoiceService } from './invoice.service.js';
import { InvoiceListQuery, InvoiceParams, OrganizationInvoiceParams, UpdateInvoiceDto } from './invoice.dto.js';

@Controller('organizations/:organizationId/invoices')
@UseGuards(AuthGuard)
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get()
  async list(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationInvoiceParams, @Query() query: InvoiceListQuery): Promise<unknown> { return this.invoices.list(principal, params.organizationId, query); }

  @Get(':invoiceId')
  async get(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: InvoiceParams): Promise<unknown> { return this.invoices.get(principal, params.organizationId, params.invoiceId); }

  @Patch(':invoiceId')
  async update(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: InvoiceParams, @Headers('idempotency-key') idempotencyKey: string | undefined, @Body() input: UpdateInvoiceDto): Promise<unknown> { return this.invoices.update(principal, params.organizationId, params.invoiceId, input, idempotencyKey); }

  @Post(':invoiceId/issue')
  @HttpCode(200)
  async issue(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: InvoiceParams, @Headers('idempotency-key') idempotencyKey: string | undefined): Promise<unknown> { return this.invoices.transition(principal, params.organizationId, params.invoiceId, 'ISSUED', idempotencyKey); }

  @Post(':invoiceId/void')
  @HttpCode(200)
  async void(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: InvoiceParams, @Headers('idempotency-key') idempotencyKey: string | undefined): Promise<unknown> { return this.invoices.transition(principal, params.organizationId, params.invoiceId, 'VOID', idempotencyKey); }
}
