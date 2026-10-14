import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import type { ExpenseStatus } from '@prisma/client';

const decimalPattern = /^\d+(?:\.\d{1,4})?$/;
const currencyPattern = /^[A-Z]{3}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export class CreateExpenseDto {
  @IsUUID()
  establishmentId!: string;

  @IsString()
  @MaxLength(500)
  description!: string;

  @IsString()
  @MaxLength(80)
  category!: string;

  @Matches(decimalPattern)
  amount!: string;

  @Matches(currencyPattern)
  currency!: string;

  @IsDateString()
  @Matches(datePattern)
  expenseDate!: string;

  @IsOptional()
  @IsUUID()
  partyId?: string;
}

export class UpdateExpenseDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsDateString()
  @Matches(datePattern)
  expenseDate?: string;

  @IsOptional()
  @IsUUID()
  partyId?: string | null;
}

export class RecordExpenseDto {}

export class VoidExpenseDto {
  @IsString()
  @MaxLength(2000)
  reason!: string;
}

export class ExpenseListQuery {
  @IsOptional()
  @IsUUID()
  establishmentId?: string;

  @IsOptional()
  @IsEnum(['DRAFT', 'RECORDED', 'VOID'])
  status?: ExpenseStatus;

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
