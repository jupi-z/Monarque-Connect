import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,63}$/)
  businessTypeCode!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{2,49}$/)
  handle!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  defaultCurrency!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  establishmentName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  establishmentCode?: string;

  @IsOptional()
  @IsIn(['HEAD_OFFICE', 'BRANCH', 'SHOP', 'OFFICE', 'SERVICE_POINT', 'OTHER'])
  establishmentType?: 'HEAD_OFFICE' | 'BRANCH' | 'SHOP' | 'OFFICE' | 'SERVICE_POINT' | 'OTHER';
}

export class OrganizationIdParam {
  @IsUUID()
  organizationId!: string;
}

export class CreateEstablishmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsIn(['HEAD_OFFICE', 'BRANCH', 'SHOP', 'OFFICE', 'SERVICE_POINT', 'OTHER'])
  type!: 'HEAD_OFFICE' | 'BRANCH' | 'SHOP' | 'OFFICE' | 'SERVICE_POINT' | 'OTHER';
}

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalName?: string;
}
