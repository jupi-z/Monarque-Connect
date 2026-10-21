import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsDefined,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { INTELLIGENCE_METRIC_CODES } from './intelligence.constants.js';

const utcDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const maxActivityWindowMs = 366 * 24 * 60 * 60 * 1000;

@ValidatorConstraint({ name: 'utcActivityWindow', async: false })
class UtcActivityWindowConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const { from, to } = args.object as { from?: string; to?: string };
    if (!from && !to) return true;
    if (!from || !to) return false;

    const start = Date.parse(from);
    const end = Date.parse(to);
    return Number.isFinite(start) && Number.isFinite(end)
      && start < end && end - start <= maxActivityWindowMs
      && start % 86_400_000 === 0 && end % 86_400_000 === 0;
  }

  defaultMessage(): string {
    return 'from and to must define an increasing UTC window no longer than 366 days';
  }
}

export class OrganizationIntelligenceParams {
  @IsUUID()
  organizationId!: string;
}

export class IntelligenceAlertParams extends OrganizationIntelligenceParams {
  @IsUUID()
  alertId!: string;
}

export class IntelligenceDashboardQuery {
  @IsDefined()
  @IsDateString({ strict: true })
  @Matches(utcDateTimePattern)
  @Validate(UtcActivityWindowConstraint)
  declare from: string;

  @IsDefined()
  @IsDateString({ strict: true })
  @Matches(utcDateTimePattern)
  @Validate(UtcActivityWindowConstraint)
  declare to: string;

  @IsOptional()
  @IsUUID()
  establishmentId?: string;
}

export enum IntelligenceGrain {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
}

export enum IntelligenceAlertStatus {
  OPEN = 'OPEN',
  RESOLVED = 'RESOLVED',
}

export enum IntelligenceAlertSeverity {
  WARNING = 'WARNING',
}

export class IntelligenceMetricsQuery {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.split(',') : value)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(INTELLIGENCE_METRIC_CODES, { each: true })
  metricCodes?: string[];

  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(utcDateTimePattern)
  @Validate(UtcActivityWindowConstraint)
  declare from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(utcDateTimePattern)
  @Validate(UtcActivityWindowConstraint)
  declare to?: string;

  @IsOptional()
  @IsUUID()
  establishmentId?: string;

  @IsOptional()
  @IsEnum(IntelligenceGrain)
  grain: IntelligenceGrain = IntelligenceGrain.DAY;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  cursor?: string;
}

export class IntelligenceAlertsQuery {
  @IsOptional()
  @IsEnum(IntelligenceAlertStatus)
  status: IntelligenceAlertStatus = IntelligenceAlertStatus.OPEN;

  @IsOptional()
  @IsEnum(IntelligenceAlertSeverity)
  severity?: IntelligenceAlertSeverity;

  @IsOptional()
  @IsUUID()
  establishmentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  cursor?: string;
}
