import { Transform } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

const numberTransform = ({ value }: { value: unknown }): unknown => value === undefined ? value : Number(value);
const moneyPattern = /^\d+(?:\.\d{1,4})?$/;

export class OrganizationInvoicePaymentParams {
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  invoiceId!: string;
}

export class OrganizationPaymentParams {
  @IsUUID()
  organizationId!: string;
}

export class PaymentParams extends OrganizationPaymentParams {
  @IsUUID()
  paymentId!: string;
}

export class CreatePaymentRecordDto {
  @IsString()
  @Matches(moneyPattern)
  amount!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsString()
  @MaxLength(40)
  methodCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  reference?: string;

  @IsDateString()
  paidAt!: string;
}

export class PaymentListQuery {
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
