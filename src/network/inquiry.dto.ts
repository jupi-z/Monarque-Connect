import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

const inquiryStatuses = ['NEW', 'QUALIFIED', 'DISMISSED', 'CONVERTED'] as const;
const transitionStatuses = ['QUALIFIED', 'DISMISSED'] as const;

const numberTransform = ({ value }: { value: unknown }): unknown => value === undefined ? value : Number(value);

export class OrganizationInquiryParams {
  @IsUUID()
  organizationId!: string;
}

export class NetworkInquiryParams extends OrganizationInquiryParams {
  @IsUUID()
  inquiryId!: string;
}

export class NetworkInquiryTargetParams extends OrganizationInquiryParams {
  @IsUUID()
  targetOrganizationId!: string;
}

export class CreateNetworkInquiryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  subject!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message!: string;

  @IsOptional()
  @IsIn(['CUSTOMER', 'SUPPLIER', 'BOTH'])
  requestedPartyType?: 'CUSTOMER' | 'SUPPLIER' | 'BOTH';
}

export class NetworkInquiryListQuery {
  @IsOptional()
  @IsIn(inquiryStatuses)
  status?: (typeof inquiryStatuses)[number];

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

export class TransitionNetworkInquiryDto {
  @IsIn(transitionStatuses)
  status!: (typeof transitionStatuses)[number];
}

export class ConvertNetworkInquiryDto {
  @IsIn(['LEAD', 'OPPORTUNITY'])
  targetType!: 'LEAD' | 'OPPORTUNITY';

  @IsOptional()
  @IsUUID()
  establishmentId?: string;
}
