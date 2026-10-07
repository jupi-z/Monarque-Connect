import { IsArray, IsEnum, IsIn, IsOptional, IsUUID, ArrayUnique } from 'class-validator';
import { MembershipStatus, ScopeMode, TenantRole } from '@prisma/client';

export class UpdateMembershipDto {
  @IsOptional()
  @IsIn(['ADMIN', 'SALES', 'FINANCE', 'OPERATIONS', 'VIEWER'])
  role?: Exclude<TenantRole, 'OWNER'>;

  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;

  @IsOptional()
  @IsEnum(ScopeMode)
  scopeMode?: ScopeMode;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  establishmentIds?: string[];
}
