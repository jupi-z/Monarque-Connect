import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class OrganizationNetworkProfileParams {
  @IsUUID()
  organizationId!: string;
}

export class PublicNetworkOrganizationParams {
  @IsUUID()
  organizationId!: string;
}

export class UpdateOrganizationNetworkProfileDto {
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  categories?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(160)
  publicLocation?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  publishedItemIds?: string[];
}
