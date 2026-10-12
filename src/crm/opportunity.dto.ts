import { Transform } from 'class-transformer';
import { IsInt, IsIn, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const numberTransform = ({ value }: { value: unknown }): unknown => value === undefined ? value : Number(value);

export class OrganizationOpportunityParams {
  @IsUUID()
  organizationId!: string;
}

export class OpportunityStatusParams extends OrganizationOpportunityParams {
  @IsUUID()
  opportunityId!: string;
}

export class CreateOpportunityDto {
  @IsUUID()
  establishmentId!: string;

  @IsOptional()
  @IsUUID()
  partyId?: string;

  @IsOptional()
  @IsUUID()
  networkInquiryId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  expectedValue?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
}

export class OpportunityListQuery {
  @IsOptional()
  @IsIn(['OPEN', 'WON', 'LOST', 'CANCELLED'])
  status?: 'OPEN' | 'WON' | 'LOST' | 'CANCELLED';

  @IsOptional()
  @IsUUID()
  establishmentId?: string;

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

export class TransitionOpportunityDto {
  @IsIn(['WON', 'LOST', 'CANCELLED'])
  status!: 'WON' | 'LOST' | 'CANCELLED';
}
