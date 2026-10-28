import { IsDateString, IsString, Matches, MaxLength } from 'class-validator';

export class IngestFxRateDto {
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  baseCurrency!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  quoteCurrency!: string;

  @IsString()
  @MaxLength(25)
  @Matches(/^(?=.*[1-9])(?:0|[1-9]\d{0,5})(?:\.\d{1,18})?$/)
  rate!: string;

  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Z][A-Z0-9._-]{0,63}$/)
  sourceCode!: string;

  @IsDateString({ strict: true })
  observedAt!: string;

  @IsDateString({ strict: true })
  validFrom!: string;

  @IsDateString({ strict: true })
  validUntil!: string;

  @IsString()
  @MaxLength(256)
  @Matches(/^[^\r\n]+$/)
  sourceReference!: string;
}
