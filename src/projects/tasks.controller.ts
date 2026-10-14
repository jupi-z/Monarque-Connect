import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CreateTaskDto, ProjectTaskParams, TaskListQuery, TaskParams, TransitionTaskDto, UpdateTaskDto } from './projects.dto.js';
import { TaskService } from './task.service.js';

@Controller('organizations/:organizationId')
@UseGuards(AuthGuard)
export class TasksController {
  constructor(private readonly tasks: TaskService) {}

  @Get('projects/:projectId/tasks')
  list(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: ProjectTaskParams, @Query() query: TaskListQuery): Promise<unknown> { return this.tasks.list(principal, params.organizationId, params.projectId, query); }

  @Post('projects/:projectId/tasks')
  create(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: ProjectTaskParams, @Headers('idempotency-key') key: string | undefined, @Body() input: CreateTaskDto): Promise<unknown> { return this.tasks.create(principal, params.organizationId, params.projectId, input, key); }

  @Get('tasks/:taskId')
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: TaskParams): Promise<unknown> { return this.tasks.get(principal, params.organizationId, params.taskId); }

  @Patch('tasks/:taskId')
  update(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: TaskParams, @Headers('idempotency-key') key: string | undefined, @Body() input: UpdateTaskDto): Promise<unknown> { return this.tasks.update(principal, params.organizationId, params.taskId, input, key); }

  @Post('tasks/:taskId/transition')
  transition(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: TaskParams, @Headers('idempotency-key') key: string | undefined, @Body() input: TransitionTaskDto): Promise<unknown> { return this.tasks.transition(principal, params.organizationId, params.taskId, input, key); }
}
