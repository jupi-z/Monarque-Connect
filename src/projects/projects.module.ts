import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../events/event.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { ProjectService } from './project.service.js';
import { TaskService } from './task.service.js';
import { ProjectsController } from './projects.controller.js';
import { TasksController } from './tasks.controller.js';

@Module({
  imports: [AuthModule, EventModule, TenancyModule],
  controllers: [ProjectsController, TasksController],
  providers: [ProjectService, TaskService],
  exports: [ProjectService, TaskService],
})
export class ProjectsModule {}
