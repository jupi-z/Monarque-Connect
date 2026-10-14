import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import type { CashAccountStatus, CashMovementDirection, CashMovementSourceType } from '@prisma/client';

const decimalPattern = /^\d+(?:\.\d{1,4})?$/;
const currencyPattern = /^[A-Z]{3}$/;

export class CreateCashAccountDto {
  @IsUUID()
  establishmentId!: string;

  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]{1,31}$/)
  code!: string;

  @IsString()
  @MaxLength(160)
  name!: string;

  @Matches(currencyPattern)
  currency!: string;
}

export class UpdateCashAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;
}

export class ChangeCashAccountStatusDto {
  @IsString()
  @MaxLength(2000)
  reason!: string;
}

export class CashAccountListQuery {
  @IsOptional()
  @IsUUID()
  establishmentId?: string;

  @IsOptional()
  @IsEnum(['ACTIVE', 'INACTIVE'])
  status?: CashAccountStatus;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CreateCashMovementDto {
  @IsUUID()
  establishmentId!: string;

  @IsUUID()
  cashAccountId!: string;

  @IsEnum(['IN', 'OUT'])
  direction!: CashMovementDirection;

  @Matches(decimalPattern)
  amount!: string;

  @IsDateString()
  occurredAt!: string;

  @IsString()
  @MaxLength(2000)
  reason!: string;

  @IsOptional()
  @IsEnum(['PAYMENT_RECORD', 'EXPENSE'])
  sourceType?: Extract<CashMovementSourceType, 'PAYMENT_RECORD' | 'EXPENSE'>;

  @IsOptional()
  @IsUUID()
  sourceId?: string;
}

export class CorrectCashMovementDto {
  @IsString()
  @MaxLength(2000)
  reason!: string;
}

export class CashMovementListQuery {
  @IsOptional()
  @IsUUID()
  cashAccountId?: string;

  @IsOptional()
  @IsUUID()
  establishmentId?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CreateCashTransferDto {
  @IsUUID()
  establishmentId!: string;

  @IsUUID()
  sourceCashAccountId!: string;

  @IsUUID()
  destinationCashAccountId!: string;

  @Matches(decimalPattern)
  amount!: string;

  @IsDateString()
  occurredAt!: string;

  @IsString()
  @MaxLength(2000)
  reason!: string;
}
