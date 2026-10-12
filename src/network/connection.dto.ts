import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

const connectionStatuses = ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED'] as const;
const transitionStatuses = ['ACCEPTED', 'DECLINED', 'CANCELLED'] as const;
const numberTransform = ({ value }: { value: unknown }): unknown => value === undefined ? value : Number(value);

export class OrganizationConnectionParams {
  @IsUUID()
  organizationId!: string;
}

export class ConnectionRequestParams extends OrganizationConnectionParams {
  @IsUUID()
  connectionRequestId!: string;
}

export class CreateConnectionRequestDto {
  @IsUUID()
  targetOrganizationId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}

export class UpdateConnectionRequestDto {
  @IsIn(transitionStatuses)
  status!: (typeof transitionStatuses)[number];
}

export class ConnectionRequestListQuery {
  @IsOptional()
  @IsIn(connectionStatuses)
  status?: (typeof connectionStatuses)[number];

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

export type ConnectionRequestStatusValue = (typeof connectionStatuses)[number];
