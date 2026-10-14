import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, registerDecorator, type ValidationArguments, type ValidationOptions, ValidatorConstraint, type ValidatorConstraintInterface } from 'class-validator';

const bigintTransform = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || typeof value === 'bigint') return value;
  if (typeof value === 'number' && !Number.isInteger(value)) return value;
  try { return BigInt(value as string | number); } catch { return value; }
};
const numberTransform = ({ value }: { value: unknown }): unknown => value === undefined ? value : Number(value);

@ValidatorConstraint({ name: 'positiveBigInt', async: false })
class PositiveBigIntConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean { return typeof value === 'bigint' && value >= 1n; }
  defaultMessage(args?: ValidationArguments): string { return `${args?.property ?? 'value'} must be a positive integer`; }
}

function IsPositiveBigInt(validationOptions?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) => registerDecorator({ target: target.constructor, propertyName: propertyKey.toString(), validator: PositiveBigIntConstraint, ...(validationOptions ? { options: validationOptions } : {}) });
}

export const documentTargetTypes = ['PROJECT', 'TASK', 'OPPORTUNITY', 'PARTY', 'QUOTE', 'SALES_ORDER', 'INVOICE', 'PAYMENT_RECORD', 'SUPPLIER_RFQ', 'PURCHASE_ORDER', 'GOODS_RECEIPT', 'EXPENSE'] as const;
export type DocumentTargetType = (typeof documentTargetTypes)[number];

export class OrganizationDocumentParams {
  @IsUUID()
  organizationId!: string;
}

export class DocumentParams extends OrganizationDocumentParams {
  @IsUUID()
  documentId!: string;
}

export class DocumentLinkParams extends DocumentParams {
  @IsUUID()
  linkId!: string;
}

export class StartDocumentUploadDto {
  @IsUUID()
  establishmentId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  originalFilename!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  mediaType!: string;

  @Transform(bigintTransform)
  @IsPositiveBigInt()
  byteSize!: bigint;

  @IsIn(['INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'])
  classification!: 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';

  @IsOptional()
  links?: CreateDocumentLinkDto[];
}

export class CompleteDocumentUploadDto {
  @IsString()
  @Matches(/^[A-Fa-f0-9]{64}$/)
  checksumSha256!: string;

  @Transform(bigintTransform)
  @IsPositiveBigInt()
  byteSize!: bigint;
}

export class CreateDocumentLinkDto {
  @IsIn(documentTargetTypes)
  targetType!: DocumentTargetType;

  @IsUUID()
  targetId!: string;
}

export class RevokeDocumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;
}

export class DocumentListQuery {
  @IsOptional()
  @IsUUID()
  establishmentId?: string;

  @IsOptional()
  @IsIn(documentTargetTypes)
  targetType?: DocumentTargetType;

  @IsOptional()
  @IsUUID()
  targetId?: string;

  @IsOptional()
  @IsIn(['PENDING_UPLOAD', 'AVAILABLE', 'QUARANTINED', 'REVOKED'])
  status?: 'PENDING_UPLOAD' | 'AVAILABLE' | 'QUARANTINED' | 'REVOKED';

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
