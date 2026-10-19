import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

const numberTransform = ({ value }: { value: unknown }): unknown => value === undefined ? value : Number(value);

export class ConversationOrganizationParams {
  @IsUUID()
  organizationId!: string;
}

export class ConversationParams extends ConversationOrganizationParams {
  @IsUUID()
  conversationId!: string;
}

export class InvitationParams extends ConversationOrganizationParams {
  @IsUUID()
  invitationId!: string;
}

export class ParticipantParams extends ConversationParams {
  @IsUUID()
  userId!: string;
}

export class CreateConversationDto {
  @IsUUID()
  targetOrganizationId!: string;

  @IsOptional()
  @IsUUID()
  sourceEstablishmentId?: string;
}

export class CreateParticipantInvitationDto {
  @IsUUID()
  userId!: string;

  @IsOptional()
  @IsString()
  expiresAt?: string | null;
}

export class AcceptConversationInvitationDto {
  @IsString()
  token!: string;
}

export class InvitationDecisionDto {
  @IsString()
  token!: string;
}

export class ConversationListQuery {
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
