import { ConflictException } from '@nestjs/common';
import type { ProjectStatus, TaskStatus } from '@prisma/client';

const projectTransitions: Record<ProjectStatus, readonly ProjectStatus[]> = {
  PLANNED: ['ACTIVE'],
  ACTIVE: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

const taskTransitions: Record<TaskStatus, readonly TaskStatus[]> = {
  TODO: ['IN_PROGRESS'],
  IN_PROGRESS: ['DONE', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
};

export function assertProjectTransition(current: string, target: string): void {
  if (!projectTransitions[current as ProjectStatus]?.includes(target as ProjectStatus)) {
    throw new ConflictException(`Project cannot transition from ${current} to ${target}`);
  }
}

export function assertTaskTransition(current: string, target: string): void {
  if (!taskTransitions[current as TaskStatus]?.includes(target as TaskStatus)) {
    throw new ConflictException(`Task cannot transition from ${current} to ${target}`);
  }
}
