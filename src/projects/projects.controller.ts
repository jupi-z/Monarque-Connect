import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CreateProjectDto, OrganizationProjectParams, ProjectListQuery, ProjectParams, TransitionProjectDto, UpdateProjectDto } from './projects.dto.js';
import { ProjectService } from './project.service.js';

@Controller('organizations/:organizationId/projects')
@UseGuards(AuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectService) {}

  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationProjectParams, @Query() query: ProjectListQuery): Promise<unknown> { return this.projects.list(principal, params.organizationId, query); }

  @Post()
  create(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationProjectParams, @Headers('idempotency-key') key: string | undefined, @Body() input: CreateProjectDto): Promise<unknown> { return this.projects.create(principal, params.organizationId, input, key); }

  @Get(':projectId')
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: ProjectParams): Promise<unknown> { return this.projects.get(principal, params.organizationId, params.projectId); }

  @Patch(':projectId')
  update(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: ProjectParams, @Headers('idempotency-key') key: string | undefined, @Body() input: UpdateProjectDto): Promise<unknown> { return this.projects.update(principal, params.organizationId, params.projectId, input, key); }

  @Post(':projectId/transition')
  @HttpCode(200)
  transition(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: ProjectParams, @Headers('idempotency-key') key: string | undefined, @Body() input: TransitionProjectDto): Promise<unknown> { return this.projects.transition(principal, params.organizationId, params.projectId, input, key); }
}
