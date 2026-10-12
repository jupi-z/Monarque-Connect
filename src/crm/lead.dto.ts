import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

const numberTransform = ({ value }: { value: unknown }): unknown => value === undefined ? value : Number(value);

export class OrganizationLeadParams {
  @IsUUID()
  organizationId!: string;
}

export class LeadParams extends OrganizationLeadParams {
  @IsUUID()
  leadId!: string;
}

export class CreateLeadDto {
  @IsOptional()
  @IsUUID()
  partyId?: string;

  @IsOptional()
  @IsUUID()
  networkInquiryId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  displayName!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}

export class LeadListQuery {
  @IsOptional()
  @IsIn(['NEW', 'QUALIFIED', 'CONVERTED', 'DISMISSED'])
  status?: 'NEW' | 'QUALIFIED' | 'CONVERTED' | 'DISMISSED';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

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

export class TransitionLeadDto {
  @IsIn(['NEW', 'QUALIFIED', 'CONVERTED', 'DISMISSED'])
  status!: 'NEW' | 'QUALIFIED' | 'CONVERTED' | 'DISMISSED';
}
