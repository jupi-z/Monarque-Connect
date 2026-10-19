import { Body, Controller, Get, Headers, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { BillingService } from './billing.service.js';
import { BillingProviderService } from './billing-provider.service.js';
import { CreateBillingCheckoutOrderDto, CreateBillingPaymentAttemptDto, CreateBillingQuoteDto, EstimateBillingCapacityDto } from './billing.dto.js';

@Controller()
export class BillingCatalogController {
  constructor(private readonly billing: BillingService) {}
  @Get('billing/catalog') catalog(): Promise<unknown> { return this.billing.catalog(); }
}

@Controller('organizations/:organizationId/billing')
@UseGuards(AuthGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('quotes') createQuote(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: CreateBillingQuoteDto): Promise<unknown> { return this.billing.createQuote(principal, organizationId, input, key); }
  @Get('quotes/:quoteId') getQuote(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Param('quoteId') quoteId: string): Promise<unknown> { return this.billing.getQuote(principal, organizationId, quoteId); }
  @Post('checkout-orders') createCheckoutOrder(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: CreateBillingCheckoutOrderDto): Promise<unknown> { return this.billing.createCheckoutOrder(principal, organizationId, input, key); }
  @Get('checkout-orders/:checkoutOrderId') getCheckoutOrder(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Param('checkoutOrderId') checkoutOrderId: string): Promise<unknown> { return this.billing.getCheckoutOrder(principal, organizationId, checkoutOrderId); }
  @Post('checkout-orders/:checkoutOrderId/payment-attempts') createPaymentAttempt(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Param('checkoutOrderId') checkoutOrderId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: CreateBillingPaymentAttemptDto): Promise<unknown> { return this.billing.createPaymentAttempt(principal, organizationId, checkoutOrderId, input, key); }
  @Get('capacity') capacity(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string): Promise<unknown> { return this.billing.capacity(principal, organizationId); }
  @Post('capacity/estimate') @HttpCode(200) estimateCapacity(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Body() input: EstimateBillingCapacityDto): Promise<unknown> { return this.billing.estimateCapacity(principal, organizationId, input); }
}

@Controller('billing/providers')
export class BillingProviderController {
  constructor(private readonly provider: BillingProviderService) {}

  @Post(':provider/webhook')
  @HttpCode(202)
  receiveWebhook(@Param('provider') provider: string, @Headers('x-provider-event-id') eventId: string | undefined, @Headers('x-provider-signature') signature: string | undefined, @Body() payload: Record<string, unknown>): Promise<unknown> {
    return this.provider.receiveWebhook(provider, eventId ?? '', signature ?? '', payload);
  }
}
