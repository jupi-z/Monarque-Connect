import type { FairScaleBillingPeriod, FairScalePlanCode } from './fairscale-pricing.js';
import { IsDateString, IsIn, IsInt, IsUUID, Max, Min, IsOptional } from 'class-validator';

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
