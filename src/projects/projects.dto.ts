import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

const numberTransform = ({ value }: { value: unknown }): unknown => value === undefined ? value : Number(value);

export class OrganizationProjectParams {
  @IsUUID()
  organizationId!: string;
}

export class ProjectParams extends OrganizationProjectParams {
  @IsUUID()
  projectId!: string;
}

export class TaskParams extends OrganizationProjectParams {
  @IsUUID()
  taskId!: string;
}

export class ProjectTaskParams extends ProjectParams {}

export class CreateProjectDto {
  @IsUUID()
  establishmentId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsUUID()
  partyId?: string;

  @IsOptional()
  @IsUUID()
  opportunityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  startsOn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  dueOn?: string;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsUUID()
  partyId?: string | null;

  @IsOptional()
  @IsUUID()
  opportunityId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  startsOn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  dueOn?: string | null;
}

export class TransitionProjectDto {
  @IsIn(['ACTIVE', 'COMPLETED', 'CANCELLED'])
  status!: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason?: string;
}

export class ProjectListQuery {
  @IsOptional()
  @IsUUID()
  establishmentId?: string;

  @IsOptional()
  @IsIn(['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED'])
  status?: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

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

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsUUID()
  assigneeUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  dueOn?: string;

  @IsOptional()
  @Transform(numberTransform)
  @IsInt()
  @Min(0)
  position?: number;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsUUID()
  assigneeUserId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  dueOn?: string | null;

  @IsOptional()
  @Transform(numberTransform)
  @IsInt()
  @Min(0)
  position?: number;
}

export class TransitionTaskDto {
  @IsIn(['IN_PROGRESS', 'DONE', 'CANCELLED'])
  status!: 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason?: string;
}

export class TaskListQuery {
  @IsOptional()
  @IsIn(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'])
  status?: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

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
