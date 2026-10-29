import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { ProductCodeQueryDto } from './pricing-policy.dto.js';
import { CreatePricingQuoteDto, PricingQuoteOrganizationParams, PricingQuoteParams, RevokePricingQuoteDto } from './pricing-quote.dto.js';
import { PricingQuoteService } from './pricing-quote.service.js';

@Controller('organizations/:organizationId/pricing')
@UseGuards(AuthGuard)
export class PricingQuoteController {
  constructor(private readonly quotes: PricingQuoteService) {}

  @Post('quotes')
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param() params: PricingQuoteOrganizationParams,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreatePricingQuoteDto,
  ): Promise<Record<string, unknown>> {
    return this.quotes.create(principal, params.organizationId, input, key);
  }

  @Get('quotes/:quoteId')
  get(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param() params: PricingQuoteParams,
    @Query() query: ProductCodeQueryDto,
  ): Promise<Record<string, unknown>> {
    return this.quotes.get(principal, params.organizationId, params.quoteId, query.productCode);
  }

  @Post('quotes/:quoteId/revoke')
  revoke(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param() params: PricingQuoteParams,
    @Headers('idempotency-key') key: string | undefined,
    @Query() query: ProductCodeQueryDto,
    @Body() input: RevokePricingQuoteDto,
  ): Promise<Record<string, unknown>> {
    return this.quotes.revoke(principal, params.organizationId, params.quoteId, query.productCode, input, key);
  }
}
