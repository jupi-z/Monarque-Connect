import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CreatePaymentRecordDto, OrganizationInvoicePaymentParams, PaymentListQuery, PaymentParams } from './payment.dto.js';
import { PaymentService } from './payment.service.js';

@Controller()
@UseGuards(AuthGuard)
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Get('organizations/:organizationId/invoices/:invoiceId/payments')
  async list(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationInvoicePaymentParams, @Query() query: PaymentListQuery): Promise<unknown> { return this.payments.list(principal, params.organizationId, params.invoiceId, query); }

  @Post('organizations/:organizationId/invoices/:invoiceId/payments')
  async record(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationInvoicePaymentParams, @Headers('idempotency-key') idempotencyKey: string | undefined, @Body() input: CreatePaymentRecordDto): Promise<unknown> { return this.payments.record(principal, params.organizationId, params.invoiceId, input, idempotencyKey); }

  @Post('organizations/:organizationId/payments/:paymentId/reverse')
  @HttpCode(200)
  async reverse(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: PaymentParams, @Headers('idempotency-key') idempotencyKey: string | undefined): Promise<unknown> { return this.payments.reverse(principal, params.organizationId, params.paymentId, idempotencyKey); }
}
