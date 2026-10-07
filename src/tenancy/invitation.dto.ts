import { IsArray, IsEmail, IsEnum, IsIn, IsOptional, IsUUID, ArrayUnique } from 'class-validator';
import { ScopeMode, TenantRole } from '@prisma/client';

export class CreateInvitationDto {
  @IsEmail()
  email!: string;

  @IsIn(['ADMIN', 'SALES', 'FINANCE', 'OPERATIONS', 'VIEWER'])
  role!: Exclude<TenantRole, 'OWNER'>;

  @IsEnum(ScopeMode)
  scopeMode!: ScopeMode;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  establishmentIds?: string[];
}
