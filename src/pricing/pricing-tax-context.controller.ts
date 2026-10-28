import { Body, Controller, Headers, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { ClassifyCommercialOfferTaxDto, ClassifyCommercialOfferTaxParams, CreatePricingTaxContextVersionDto, PricingTaxContextCreateParams, PricingTaxContextVersionParams } from './pricing-tax-context.dto.js';
import { ActivatePricingTaxContextVersionDto, ProductCodeQueryDto } from './pricing-policy.dto.js';
import { PricingTaxContextService } from './pricing-tax-context.service.js';

@Controller('organizations/:organizationId/pricing')
@UseGuards(AuthGuard)
export class PricingTaxContextController {
  constructor(private readonly contexts: PricingTaxContextService) {}

  @Post('tax-context-versions')
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param() params: PricingTaxContextCreateParams,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreatePricingTaxContextVersionDto,
  ): Promise<Record<string, unknown>> {
    return this.contexts.create(principal, params.organizationId, input, key);
  }

  @Post('tax-context-versions/:pricingTaxContextVersionId/activate')
  @HttpCode(200)
  activate(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param() params: PricingTaxContextVersionParams,
    @Query() query: ProductCodeQueryDto,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: ActivatePricingTaxContextVersionDto,
  ): Promise<Record<string, unknown>> {
    return this.contexts.activate(principal, params.organizationId, params.pricingTaxContextVersionId, query.productCode, input, key);
  }
}

@Controller('organizations/:organizationId/catalog/offers')
@UseGuards(AuthGuard)
export class CommercialOfferTaxClassificationController {
  constructor(private readonly contexts: PricingTaxContextService) {}

  @Put(':offerId/tax-classification')
  @HttpCode(200)
  classify(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param() params: ClassifyCommercialOfferTaxParams,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: ClassifyCommercialOfferTaxDto,
  ): Promise<Record<string, unknown>> {
    return this.contexts.classifyOffer(principal, params.organizationId, params.offerId, input, key);
  }
}
