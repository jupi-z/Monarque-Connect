import { Body, Controller, Headers, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import {
  ActivateTaxPolicyVersionDto,
  CreateCommercialDiscountRuleVersionDto,
  CreatePricingPolicyVersionDto,
  CreateTaxPolicyVersionDto,
  PricingOrganizationParams,
  ProductCodeQueryDto,
  TaxPolicyVersionParams,
} from './pricing-policy.dto.js';
import { PricingPolicyService } from './pricing-policy.service.js';

@Controller('organizations/:organizationId/pricing')
@UseGuards(AuthGuard)
export class PricingPolicyController {
  constructor(private readonly policies: PricingPolicyService) {}

  @Post('policy-versions')
  createPricingPolicyVersion(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param() params: PricingOrganizationParams,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreatePricingPolicyVersionDto,
  ): Promise<unknown> {
    return this.policies.createPricingPolicyVersion(principal, params.organizationId, input, key);
  }

  @Post('tax-policy-versions')
  createTaxPolicyVersion(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param() params: PricingOrganizationParams,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreateTaxPolicyVersionDto,
  ): Promise<unknown> {
    return this.policies.createTaxPolicyVersion(principal, params.organizationId, input, key);
  }

  @Post('discount-rule-versions')
  createCommercialDiscountRuleVersion(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param() params: PricingOrganizationParams,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreateCommercialDiscountRuleVersionDto,
  ): Promise<unknown> {
    return this.policies.createCommercialDiscountRuleVersion(principal, params.organizationId, input, key);
  }

  @Post('tax-policy-versions/:taxPolicyVersionId/activate')
  @HttpCode(200)
  activateTaxPolicyVersion(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param() params: TaxPolicyVersionParams,
    @Query() query: ProductCodeQueryDto,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: ActivateTaxPolicyVersionDto,
  ): Promise<unknown> {
    return this.policies.activateTaxPolicyVersion(
      principal,
      params.organizationId,
      params.taxPolicyVersionId,
      query.productCode,
      input,
      key,
    );
  }
}
