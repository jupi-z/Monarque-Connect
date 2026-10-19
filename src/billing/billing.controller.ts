import { Body, Controller, Get, Headers, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { PlatformAuthorizationService } from '../entitlements/platform-authorization.service.js';
import { BillingService } from './billing.service.js';
import { BillingProviderService } from './billing-provider.service.js';
import { BillingLifecycleService } from './billing-lifecycle.service.js';
import { CreateBillingCheckoutOrderDto, CreateBillingPaymentAttemptDto, CreateBillingQuoteDto, EstimateBillingCapacityDto, RunBillingJobDto, ScheduleBillingChangeDto } from './billing.dto.js';

@Controller()
export class BillingCatalogController {
  constructor(private readonly billing: BillingService) {}
  @Get('billing/catalog') catalog(): Promise<unknown> { return this.billing.catalog(); }
}

@Controller('organizations/:organizationId/billing')
@UseGuards(AuthGuard)
export class BillingController {
  constructor(private readonly billing: BillingService, private readonly lifecycle: BillingLifecycleService) {}

  @Post('quotes') createQuote(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: CreateBillingQuoteDto): Promise<unknown> { return this.billing.createQuote(principal, organizationId, input, key); }
  @Get('quotes/:quoteId') getQuote(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Param('quoteId') quoteId: string): Promise<unknown> { return this.billing.getQuote(principal, organizationId, quoteId); }
  @Post('checkout-orders') createCheckoutOrder(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: CreateBillingCheckoutOrderDto): Promise<unknown> { return this.billing.createCheckoutOrder(principal, organizationId, input, key); }
  @Get('checkout-orders/:checkoutOrderId') getCheckoutOrder(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Param('checkoutOrderId') checkoutOrderId: string): Promise<unknown> { return this.billing.getCheckoutOrder(principal, organizationId, checkoutOrderId); }
  @Post('checkout-orders/:checkoutOrderId/payment-attempts') createPaymentAttempt(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Param('checkoutOrderId') checkoutOrderId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: CreateBillingPaymentAttemptDto): Promise<unknown> { return this.billing.createPaymentAttempt(principal, organizationId, checkoutOrderId, input, key); }
  @Get('subscription') getSubscription(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string): Promise<unknown> { return this.lifecycle.getSubscription(principal, organizationId); }
  @Get('invoices') listInvoices(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string): Promise<unknown> { return this.lifecycle.listInvoices(principal, organizationId); }
  @Post('subscription/:termId/changes') scheduleChange(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Param('termId') termId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: ScheduleBillingChangeDto): Promise<unknown> { return this.lifecycle.scheduleChange(principal, organizationId, termId, input, key); }
  @Post('subscription/changes/:changeId/cancel') cancelChange(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Param('changeId') changeId: string): Promise<unknown> { return this.lifecycle.cancelScheduledChange(principal, organizationId, changeId); }
  @Get('capacity') capacity(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string): Promise<unknown> { return this.billing.capacity(principal, organizationId); }
  @Post('capacity/estimate') @HttpCode(200) estimateCapacity(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Body() input: EstimateBillingCapacityDto): Promise<unknown> { return this.billing.estimateCapacity(principal, organizationId, input); }
}

@Controller('platform/billing')
@UseGuards(AuthGuard)
export class PlatformBillingController {
  constructor(private readonly platformAuthorization: PlatformAuthorizationService, private readonly lifecycle: BillingLifecycleService) {}

  @Get('terms')
  async listTerms(@CurrentPrincipal() principal: AuthPrincipal): Promise<unknown> {
    this.platformAuthorization.assertPlatformAdmin(principal);
    return this.lifecycle.listPlatformTerms();
  }

  @Get('invoices')
  async listInvoices(@CurrentPrincipal() principal: AuthPrincipal): Promise<unknown> {
    this.platformAuthorization.assertPlatformAdmin(principal);
    return this.lifecycle.listPlatformInvoices();
  }

  @Post('renewals/run')
  @HttpCode(200)
  async runRenewals(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: RunBillingJobDto): Promise<unknown> {
    this.platformAuthorization.assertPlatformAdmin(principal);
    return this.lifecycle.renewDueTerms(input.at ? new Date(input.at) : new Date(), input.limit ?? 100, input.provider);
  }

  @Post('dunning/run')
  @HttpCode(200)
  async runDunning(@CurrentPrincipal() principal: AuthPrincipal, @Body() input: RunBillingJobDto): Promise<unknown> {
    this.platformAuthorization.assertPlatformAdmin(principal);
    return this.lifecycle.runDunning(input.at ? new Date(input.at) : new Date(), input.limit ?? 100);
  }
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
