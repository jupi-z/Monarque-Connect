import type { FairScaleBillingPeriod, FairScalePlanCode } from './fairscale-pricing.js';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class SetBillingCustomerVerificationDto {
  @IsIn(['UNVERIFIED', 'VERIFIED', 'REVIEW_REQUIRED', 'SUSPENDED'])
  status!: 'UNVERIFIED' | 'VERIFIED' | 'REVIEW_REQUIRED' | 'SUSPENDED';

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class LinkBillingCustomerOrganizationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class CreateBillingQuoteDto {
  @IsIn(['CONNECT', 'OPERATIONS', 'BUSINESS', 'ENTERPRISE'])
  planCode!: FairScalePlanCode;
  @IsIn(['MONTHLY', 'YEARLY'])
  billingPeriod!: FairScaleBillingPeriod;
  @IsInt()
  @Min(1)
  @Max(10000)
  activeEstablishmentCount!: number;
  @IsOptional()
  @IsDateString()
  asOf?: string;
}

export class EstimateBillingCapacityDto {
  @IsInt()
  @Min(1)
  @Max(10000)
  activeEstablishmentCount!: number;
  @IsInt()
  @Min(0)
  @Max(10000)
  addonEstablishmentCount!: number;
}

export class CreateBillingCheckoutOrderDto {
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsUUID()
  quoteId!: string;
}

export class CreateBillingPaymentAttemptDto {
  @IsIn(['MANUAL_REVIEW', 'TEST'])
  provider!: string;
}

export class CancelBillingSubscriptionDto {
  @IsDateString()
  effectiveAt!: string;
}

export class ScheduleBillingChangeDto {
  @IsIn(['PLAN_CHANGE', 'PERIOD_CHANGE', 'ADDON_CHANGE', 'CANCELLATION'])
  kind!: 'PLAN_CHANGE' | 'PERIOD_CHANGE' | 'ADDON_CHANGE' | 'CANCELLATION';

  @IsOptional()
  @IsDateString()
  effectiveAt?: string;

  @IsOptional()
  @IsIn(['CONNECT', 'OPERATIONS', 'BUSINESS', 'ENTERPRISE'])
  targetPlanCode?: string;

  @IsOptional()
  @IsIn(['MONTHLY', 'YEARLY'])
  targetBillingPeriod?: 'MONTHLY' | 'YEARLY';

  @IsOptional()
  @IsString()
  addonCode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  addonQuantity?: number;
}

export class RunBillingJobDto {
  @IsOptional()
  @IsDateString()
  at?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @IsIn(['TEST'])
  provider?: 'TEST';
}

export class PublishBillingPriceDto {
  @IsIn(['CONNECT', 'OPERATIONS', 'BUSINESS', 'ENTERPRISE'])
  planCode!: 'CONNECT' | 'OPERATIONS' | 'BUSINESS' | 'ENTERPRISE';

  @IsIn(['MONTHLY', 'YEARLY'])
  billingPeriod!: 'MONTHLY' | 'YEARLY';

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsInt()
  @Min(0)
  @Max(1000000000)
  baseAmountMinor!: number;

  @IsInt()
  @Min(0)
  @Max(1000000000)
  welcomeAmountMinor!: number;

  @IsInt()
  @Min(0)
  @Max(1000000000)
  annualDiscountAmountMinor!: number;

  @IsInt()
  @Min(1)
  @Max(100000)
  includedEstablishments!: number;

  @IsInt()
  @Min(0)
  @Max(1000000000)
  addonAmountMinor!: number;

  @IsInt()
  @Min(1)
  @Max(100000)
  addonCapacityUnits!: number;

  @IsOptional()
  @IsDateString()
  startsAt?: string;
}
