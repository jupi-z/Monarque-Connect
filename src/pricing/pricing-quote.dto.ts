import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { PRODUCT_CODES, type ProductCode } from '../products/product-code.js';

const QUANTITY = /^(?=.*[1-9])(?:0|[1-9]\d{0,11})(?:\.\d{1,12})?$/;
const UNIT_CODE = /^[A-Z][A-Z0-9_]{0,31}$/;

export class CreatePricingQuoteDto {
  @IsIn(PRODUCT_CODES)
  productCode!: ProductCode;

  @IsUUID()
  offerId!: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsString()
  @Matches(QUANTITY)
  quantity!: string;

  @IsString()
  @Matches(UNIT_CODE)
  unitCode!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  targetCurrency?: string;

  @IsOptional()
  @IsUUID()
  establishmentId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(48)
  @Matches(/^[A-Za-z][A-Za-z0-9_]{0,47}$/)
  channelCode?: string;
}

export class PricingQuoteParams {
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  quoteId!: string;
}

export class PricingQuoteOrganizationParams {
  @IsUUID()
  organizationId!: string;
}
