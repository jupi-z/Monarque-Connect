import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

const PRODUCT_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const JURISDICTION_CODE = /^[A-Z0-9][A-Z0-9._:-]{1,63}$/;
const TAX_CATEGORY_CODE = /^[A-Z][A-Z0-9._-]{0,63}$/;

export class CreatePricingTaxContextVersionDto {
  @IsString()
  @Matches(PRODUCT_CODE)
  productCode!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID()
  establishmentId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(JURISDICTION_CODE)
  jurisdictionCode!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  effectiveFrom?: string;
}

export class PricingTaxContextCreateParams {
  @IsUUID()
  organizationId!: string;
}

export class PricingTaxContextVersionParams {
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  pricingTaxContextVersionId!: string;
}

export class ClassifyCommercialOfferTaxParams {
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  offerId!: string;
}

export class ActivatePricingTaxContextVersionDto {
  @IsIn(['OWNER_REVIEWED_CONFIGURATION'])
  acknowledgement!: 'OWNER_REVIEWED_CONFIGURATION';
}

export class ClassifyCommercialOfferTaxDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @MaxLength(64)
  @Matches(TAX_CATEGORY_CODE)
  taxCategoryCode!: string | null;
}
