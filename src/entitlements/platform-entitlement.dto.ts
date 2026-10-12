import { IsDateString, IsIn, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class PlatformOrganizationParam {
  @IsUUID()
  organizationId!: string;
}

export class SetPlatformEntitlementDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,63}$/)
  moduleCode!: string;

  @IsIn(['ALLOW', 'DENY', 'LIMIT_OVERRIDE'])
  effect!: 'ALLOW' | 'DENY' | 'LIMIT_OVERRIDE';

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsObject()
  limits?: Record<string, unknown>;
}
