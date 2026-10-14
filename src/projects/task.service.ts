import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal, AuthorizationContext } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import { assertTaskTransition } from './projects.transitions.js';
import type { CreateTaskDto, TaskListQuery, TransitionTaskDto, UpdateTaskDto } from './projects.dto.js';

type Cursor = { createdAt: string; id: string };
type Context = { requestId: string; correlationId: string };
const taskSelect = { id: true, organizationId: true, projectId: true, title: true, description: true, assigneeUserId: true, dueOn: true, status: true, position: true, createdByUserId: true, createdAt: true, updatedAt: true, completedAt: true, cancelledAt: true } as const;
type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

@Injectable()
export class TaskService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter) {}

  async list(principal: AuthPrincipal, organizationId: string, projectId: string, query: TaskListQuery): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'PROJECTS', 'projects:read');
    const project = await this.findProject(context, organizationId, projectId);
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const limit = query.limit ?? 20;
    const rows = await this.prisma.task.findMany({ where: { organizationId, projectId, ...(query.status ? { status: query.status } : {}), ...(cursor ? { OR: [{ createdAt: { gt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }] } : {}) }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], take: limit + 1, select: taskSelect });
    const items = rows.slice(0, limit).map((row) => this.serialize(row));
    const next = rows.length > limit ? rows[limit - 1] : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ createdAt: next.createdAt.toISOString(), id: next.id }) : null, projectId: project.id };
  }

  async get(principal: AuthPrincipal, organizationId: string, taskId: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'PROJECTS', 'projects:read');
    const task = await this.findScoped(context, organizationId, taskId);
    return this.serialize(task);
  }

  async create(principal: AuthPrincipal, organizationId: string, projectId: string, input: CreateTaskDto, rawKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'PROJECTS', 'projects:write');
    const project = await this.findProject(context, organizationId, projectId);
    await this.assertAssignee(organizationId, project.establishmentId, input.assigneeUserId, context);
    const dueOn = input.dueOn === undefined ? null : this.dateOnly(input.dueOn);
    const key = this.requireKey(rawKey);
    const payloadHash = this.hash({ operation: 'TASK_CREATE', projectId, input });
    const event = this.eventContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await this.findCommand(tx, organizationId, principal.userId, 'TASK_CREATE', key, payloadHash);
        if (replay) return this.getForResponse(tx, organizationId, replay.resourceId);
        const id = randomUUID();
        const task = await tx.task.create({ data: { id, organizationId, projectId, title: input.title.trim(), description: input.description?.trim() ?? null, assigneeUserId: input.assigneeUserId ?? null, dueOn, position: input.position ?? 0, createdByUserId: principal.userId }, select: taskSelect });
        await this.createCommand(tx, { organizationId, actorUserId: principal.userId, operation: 'TASK_CREATE', key, payloadHash, resourceType: 'Task', resourceId: id, establishmentId: project.establishmentId });
        await this.recordMutation(tx, 'TASK_CREATED', 'task.created', principal, organizationId, project.establishmentId, id, event, { projectId, title: task.title, status: task.status });
        return this.serialize(task);
      });
    } catch (error) {
      if (this.isUnique(error)) return this.replay(principal, organizationId, 'TASK_CREATE', key, payloadHash);
      throw error;
    }
  }

  async update(principal: AuthPrincipal, organizationId: string, taskId: string, input: UpdateTaskDto, rawKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'PROJECTS', 'projects:write');
    const current = await this.findScoped(context, organizationId, taskId);
    if (Object.keys(input).length === 0) throw new BadRequestException('At least one task field is required');
    if (current.status === 'DONE' || current.status === 'CANCELLED') throw new ConflictException('Terminal tasks are immutable');
    await this.assertAssignee(organizationId, current.establishmentId, input.assigneeUserId, context);
    const key = this.requireKey(rawKey);
    const payloadHash = this.hash({ operation: 'TASK_UPDATE', taskId, input });
    const event = this.eventContext();
        const dueUpdate = input.dueOn === undefined ? {} : { dueOn: input.dueOn === null ? null : this.dateOnly(input.dueOn) };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await this.findCommand(tx, organizationId, principal.userId, 'TASK_UPDATE', key, payloadHash);
        if (replay) return this.getForResponse(tx, organizationId, replay.resourceId);
        const changed = await tx.task.updateMany({ where: { id: taskId, organizationId, status: current.status }, data: { ...(input.title !== undefined ? { title: input.title.trim() } : {}), ...(input.description !== undefined ? { description: input.description?.trim() ?? null } : {}), ...(input.assigneeUserId !== undefined ? { assigneeUserId: input.assigneeUserId } : {}), ...dueUpdate, ...(input.position !== undefined ? { position: input.position } : {}) } });
        if (changed.count === 0) throw new ConflictException('Task was changed concurrently');
        const task = await tx.task.findFirstOrThrow({ where: { id: taskId, organizationId }, select: taskSelect });
        await this.createCommand(tx, { organizationId, actorUserId: principal.userId, operation: 'TASK_UPDATE', key, payloadHash, resourceType: 'Task', resourceId: taskId, establishmentId: current.establishmentId });
        await this.recordMutation(tx, 'TASK_UPDATED', 'task.updated', principal, organizationId, current.establishmentId, taskId, event, { fields: Object.keys(input), projectId: task.projectId });
        return this.serialize(task);
      });
    } catch (error) {
      if (this.isUnique(error)) return this.replay(principal, organizationId, 'TASK_UPDATE', key, payloadHash, taskId);
      throw error;
    }
  }

  async transition(principal: AuthPrincipal, organizationId: string, taskId: string, input: TransitionTaskDto, rawKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'PROJECTS', 'projects:write');
    const current = await this.findScoped(context, organizationId, taskId);
    assertTaskTransition(current.status, input.status);
    const key = this.requireKey(rawKey);
    const payloadHash = this.hash({ operation: 'TASK_TRANSITION', taskId, input });
    const event = this.eventContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await this.findCommand(tx, organizationId, principal.userId, 'TASK_TRANSITION', key, payloadHash);
        if (replay) return this.getForResponse(tx, organizationId, replay.resourceId);
        const changed = await tx.task.updateMany({ where: { id: taskId, organizationId, status: current.status }, data: { status: input.status, ...(input.status === 'DONE' ? { completedAt: new Date() } : {}), ...(input.status === 'CANCELLED' ? { cancelledAt: new Date() } : {}) } });
        if (changed.count === 0) throw new ConflictException('Task was changed concurrently');
        const task = await tx.task.findFirstOrThrow({ where: { id: taskId, organizationId }, select: taskSelect });
        await this.createCommand(tx, { organizationId, actorUserId: principal.userId, operation: 'TASK_TRANSITION', key, payloadHash, resourceType: 'Task', resourceId: taskId, establishmentId: current.establishmentId });
        await this.recordMutation(tx, 'TASK_STATUS_CHANGED', 'task.status_changed', principal, organizationId, current.establishmentId, taskId, event, { previousStatus: current.status, status: task.status, reason: input.reason ?? null, projectId: task.projectId });
        return this.serialize(task);
      });
    } catch (error) {
      if (this.isUnique(error)) return this.replay(principal, organizationId, 'TASK_TRANSITION', key, payloadHash, taskId);
      throw error;
    }
  }

  private async findProject(context: AuthorizationContext, organizationId: string, projectId: string): Promise<{ id: string; establishmentId: string }> {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, establishmentId: true } });
    if (!project) throw new NotFoundException();
    await this.authorization.assertEstablishment(context, project.establishmentId);
    return project;
  }

  private async findScoped(context: AuthorizationContext, organizationId: string, taskId: string): Promise<TaskRow & { establishmentId: string }> {
    const task = await this.prisma.task.findFirst({ where: { id: taskId, organizationId }, select: { ...taskSelect, project: { select: { establishmentId: true } } } });
    if (!task) throw new NotFoundException();
    await this.authorization.assertEstablishment(context, task.project.establishmentId);
    const { project, ...row } = task;
    return { ...row, establishmentId: project.establishmentId };
  }

  private async assertAssignee(organizationId: string, establishmentId: string, userId: string | null | undefined, context: AuthorizationContext): Promise<void> {
    if (userId === undefined || userId === null) return;
    const membership = await this.prisma.membership.findFirst({ where: { organizationId, userId, status: 'ACTIVE', user: { status: 'ACTIVE' }, ...(context.scopeMode === 'SELECTED_ESTABLISHMENTS' ? { scopeLinks: { some: { establishmentId } } } : {}) }, select: { id: true } });
    if (!membership) throw new ConflictException('Task assignee is not an active member in the establishment scope');
  }

  private async findCommand(tx: Prisma.TransactionClient, organizationId: string, actorUserId: string, operation: string, key: string, payloadHash: string): Promise<{ resourceId: string } | null> { const command = await tx.phase8IdempotencyKey.findUnique({ where: { organizationId_actorUserId_operation_key: { organizationId, actorUserId, operation, key } }, select: { resourceId: true, payloadHash: true } }); if (!command) return null; if (command.payloadHash !== payloadHash) throw new ConflictException('Idempotency-Key was already used with a different command'); return command; }
  private async createCommand(tx: Prisma.TransactionClient, input: { organizationId: string; actorUserId: string; operation: string; key: string; payloadHash: string; resourceType: string; resourceId: string; establishmentId: string }): Promise<void> { await tx.phase8IdempotencyKey.create({ data: { id: randomUUID(), ...input } }); }
  private async replay(principal: AuthPrincipal, organizationId: string, operation: string, key: string, payloadHash: string, expectedResourceId?: string): Promise<unknown> { const command = await this.prisma.phase8IdempotencyKey.findUnique({ where: { organizationId_actorUserId_operation_key: { organizationId, actorUserId: principal.userId, operation, key } }, select: { resourceId: true, payloadHash: true } }); if (!command || command.payloadHash !== payloadHash || (expectedResourceId !== undefined && command.resourceId !== expectedResourceId)) throw new ConflictException('Idempotency-Key could not be replayed'); return this.getForResponse(this.prisma, organizationId, command.resourceId); }
  private async getForResponse(client: PrismaService | Prisma.TransactionClient, organizationId: string, taskId: string): Promise<unknown> { const task = await client.task.findFirstOrThrow({ where: { id: taskId, organizationId }, select: taskSelect }); return this.serialize(task); }
  private async recordMutation(tx: Prisma.TransactionClient, action: AuditAction, eventType: string, principal: AuthPrincipal, organizationId: string, establishmentId: string, taskId: string, context: Context, payload: Record<string, unknown>): Promise<void> { await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, establishmentId, targetType: 'Task', targetId: taskId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } }); await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'Task', id: taskId }, organizationId, establishmentId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'projects', payload })); }
  private dateOnly(value: string): Date { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Date must be YYYY-MM-DD'); const date = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('Date is invalid'); return date; }
  private requireKey(value?: string): string { if (!value?.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new BadRequestException('Idempotency-Key is required and invalid'); return value.trim(); }
  private hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
  private eventContext(): Context { const context = currentEventContext(); return context?.requestId ? { requestId: context.requestId, correlationId: context.correlationId } : createRequestContext(); }
  private isUnique(error: unknown): boolean { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }
  private encodeCursor(cursor: Cursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }
  private decodeCursor(value: string): Cursor { try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>; if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') throw new Error(); return { createdAt: parsed.createdAt, id: parsed.id }; } catch { throw new BadRequestException('Cursor is invalid'); } }
  private serialize(task: TaskRow): unknown { return { ...task, dueOn: task.dueOn?.toISOString().slice(0, 10) ?? null, createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(), completedAt: task.completedAt?.toISOString() ?? null, cancelledAt: task.cancelledAt?.toISOString() ?? null }; }
}
