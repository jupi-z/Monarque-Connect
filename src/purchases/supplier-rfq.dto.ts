import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

const decimalPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/;
const numberTransform = ({ value }: { value: unknown }): unknown => value === undefined ? value : Number(value);

export class OrganizationSupplierRfqParams {
  @IsUUID()
  organizationId!: string;
}

export class SupplierRfqParams extends OrganizationSupplierRfqParams {
  @IsUUID()
  supplierRfqId!: string;
}

export class CreateSupplierRFQLineDto {
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  descriptionSnapshot!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  unitSnapshot!: string;

  @IsString()
  @Matches(decimalPattern)
  quantity!: string;

  @IsOptional()
  @IsUUID()
  requestedBy?: string;
}

export class CreateSupplierRFQRecipientDto {
  @IsOptional()
  @IsUUID()
  localPartyId?: string;

  @IsOptional()
  @IsUUID()
  networkOrganizationId?: string;
}

export class CreateSupplierRFQDto {
  @IsUUID()
  establishmentId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsDateString()
  neededBy?: string;

  @IsOptional()
  @IsDateString()
  needDate?: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSupplierRFQLineDto)
  lines!: CreateSupplierRFQLineDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSupplierRFQRecipientDto)
  recipients!: CreateSupplierRFQRecipientDto[];
}

export class UpdateSupplierRFQDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsDateString()
  neededBy?: string | null;

  @IsOptional()
  @IsDateString()
  needDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSupplierRFQLineDto)
  lines?: CreateSupplierRFQLineDto[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSupplierRFQRecipientDto)
  recipients?: CreateSupplierRFQRecipientDto[];
}

export class SupplierRfqListQuery {
  @IsOptional()
  @IsUUID()
  establishmentId?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Transform(numberTransform)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
