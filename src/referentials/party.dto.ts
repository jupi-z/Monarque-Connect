import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

const booleanTransform = ({ value }: { value: unknown }): unknown => value === undefined ? value : value === true || value === 'true';
const numberTransform = ({ value }: { value: unknown }): unknown => value === undefined ? value : Number(value);

export class OrganizationPartyParams {
  @IsUUID()
  organizationId!: string;
}

export class PartyParams extends OrganizationPartyParams {
  @IsUUID()
  partyId!: string;
}

export class CreatePartyDto {
  @IsIn(['CUSTOMER', 'SUPPLIER', 'BOTH'])
  type!: 'CUSTOMER' | 'SUPPLIER' | 'BOTH';

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  displayName!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  taxId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdatePartyDto {
  @IsOptional()
  @IsIn(['CUSTOMER', 'SUPPLIER', 'BOTH'])
  type?: 'CUSTOMER' | 'SUPPLIER' | 'BOTH';

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  displayName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  taxId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class PartyListQuery {
  @IsOptional()
  @IsIn(['CUSTOMER', 'SUPPLIER', 'BOTH'])
  type?: 'CUSTOMER' | 'SUPPLIER' | 'BOTH';

  @IsOptional()
  @Transform(booleanTransform)
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

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
