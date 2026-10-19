import type { FairScaleBillingPeriod, FairScalePlanCode } from './fairscale-pricing.js';
import { IsDateString, IsIn, IsInt, Max, Min, IsOptional } from 'class-validator';

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
