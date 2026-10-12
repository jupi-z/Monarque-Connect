import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const booleanTransform = ({ value }: { value: unknown }): unknown => value === undefined ? value : value === true || value === 'true';
const numberTransform = ({ value }: { value: unknown }): unknown => value === undefined ? value : Number(value);

export class DiscoveryQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  businessTypeCode?: string;

  @IsOptional()
  @Transform(booleanTransform)
  @IsBoolean()
  verified?: boolean;

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
