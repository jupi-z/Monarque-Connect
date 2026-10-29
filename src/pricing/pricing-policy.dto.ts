import { ArrayMaxSize, ArrayUnique, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SOURCE = /^[A-Z][A-Z0-9._-]{0,63}$/;

export class PricingOrganizationParams {
  @IsUUID()
  organizationId!: string;
}

export class TaxPolicyVersionParams extends PricingOrganizationParams {
  @IsUUID()
  taxPolicyVersionId!: string;
}

export class ProductCodeQueryDto {
  @IsString()
  @Matches(CODE)
  productCode!: string;
}

export class CreatePricingPolicyVersionDto {
  @IsString()
  @Matches(CODE)
  productCode!: string;

  @IsString()
  @Matches(CODE)
  code!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  effectiveFrom?: string;

  @IsIn(['HALF_UP'])
  roundingMode!: 'HALF_UP';

  @IsInt()
  @Min(1)
  @Max(2_592_000)
  maxFxAgeSeconds!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[A-Z]{3}$/, { each: true })
  allowedCurrencies?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(SOURCE, { each: true })
  allowedFxSources?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(CODE, { each: true })
  discountRuleCodes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(CODE, { each: true })
  taxPolicyCodes?: string[];
}

export class CreateTaxPolicyVersionDto {
  @IsString()
  @Matches(CODE)
  productCode!: string;

  @IsString()
  @Matches(CODE)
  code!: string;

  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Z0-9][A-Z0-9._:-]{1,63}$/)
  jurisdictionCode!: string;

  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Z][A-Z0-9._-]{0,63}$/)
  taxCategoryCode!: string;

  @IsString()
  @MaxLength(25)
  @Matches(/^(?:0|[1-9]\d{0,5})(?:\.\d{1,18})?$/)
  rate!: string;

  @IsIn(['SOURCE', 'TARGET'])
  calculationCurrency!: 'SOURCE' | 'TARGET';

  @IsOptional()
  @IsDateString({ strict: true })
  effectiveFrom?: string;

  @IsString()
  @MaxLength(512)
  @Matches(/^\S(?:[\s\S]*\S)?$/)
  configurationReference!: string;
}

export class CreateCommercialDiscountRuleVersionDto {
  @IsString()
  @Matches(CODE)
  productCode!: string;

  @IsString()
  @Matches(CODE)
  code!: string;

  @IsString()
  @MaxLength(25)
  @Matches(/^(?:0|[1-9]\d?|100)(?:\.\d{1,18})?$/)
  rate!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  effectiveFrom?: string;

  @IsString()
  @MaxLength(512)
  @Matches(/^\S(?:[\s\S]*\S)?$/)
  configurationReference!: string;
}

export class ActivateTaxPolicyVersionDto {
  @IsIn(['OWNER_REVIEWED_CONFIGURATION'])
  acknowledgement!: 'OWNER_REVIEWED_CONFIGURATION';
}
