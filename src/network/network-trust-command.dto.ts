import { IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SetNetworkTrustCommandDto {
  @IsIn(['UNVERIFIED', 'VERIFIED', 'EXPIRED'])
  status!: 'UNVERIFIED' | 'VERIFIED' | 'EXPIRED';

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  method?: string;

  @IsOptional()
  @IsDateString()
  verificationExpiresAt?: string | null;
}
