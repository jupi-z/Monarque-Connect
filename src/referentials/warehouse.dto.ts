import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

const booleanTransform = ({ value }: { value: unknown }): unknown => value === undefined ? value : value === true || value === 'true';
const numberTransform = ({ value }: { value: unknown }): unknown => value === undefined ? value : Number(value);

export class OrganizationEstablishmentParams {
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  establishmentId!: string;
}

export class WarehouseParams extends OrganizationEstablishmentParams {
  @IsUUID()
  warehouseId!: string;
}

export class CreateWarehouseDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;
}

export class UpdateWarehouseDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;
}

export class WarehouseListQuery {
  @IsOptional()
  @Transform(booleanTransform)
  @IsBoolean()
  active?: boolean;

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
