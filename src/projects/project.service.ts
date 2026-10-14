import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal, AuthorizationContext } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import { assertProjectTransition } from './projects.transitions.js';
import type { CreateProjectDto, ProjectListQuery, TransitionProjectDto, UpdateProjectDto } from './projects.dto.js';

type Cursor = { createdAt: string; id: string };
type Context = { requestId: string; correlationId: string };
const projectSelect = { id: true, organizationId: true, establishmentId: true, partyId: true, opportunityId: true, name: true, description: true, startsOn: true, dueOn: true, status: true, createdByUserId: true, createdAt: true, updatedAt: true, completedAt: true, cancelledAt: true } as const;
type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof projectSelect }>;

@Injectable()
export class ProjectService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter) {}

  async list(principal: AuthPrincipal, organizationId: string, query: ProjectListQuery): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'PROJECTS', 'projects:read');
    if (query.establishmentId) await this.authorization.assertEstablishment(context, query.establishmentId);
    const establishmentIds = query.establishmentId ? [query.establishmentId] : context.scopeMode === 'SELECTED_ESTABLISHMENTS' ? Array.from(context.establishmentIds) : undefined;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.prisma.project.findMany({
      where: { organizationId, ...(establishmentIds ? { establishmentId: { in: establishmentIds } } : {}), ...(query.status ? { status: query.status } : {}), ...(cursor ? { OR: [{ createdAt: { gt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }] } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: (query.limit ?? 20) + 1,
      select: projectSelect,
    });
    const items = rows.slice(0, query.limit ?? 20).map((row) => this.serialize(row));
    const next = rows.length > (query.limit ?? 20) ? rows[(query.limit ?? 20) - 1] : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ createdAt: next.createdAt.toISOString(), id: next.id }) : null };
  }

  async get(principal: AuthPrincipal, organizationId: string, projectId: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'PROJECTS', 'projects:read');
    const project = await this.findScoped(context, organizationId, projectId);
    return this.serialize(project);
  }

  async create(principal: AuthPrincipal, organizationId: string, input: CreateProjectDto, rawKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'PROJECTS', 'projects:write');
    await this.authorization.assertEstablishment(context, input.establishmentId);
    const dates = this.parseDates(input.startsOn, input.dueOn);
    const key = this.requireKey(rawKey);
    const payloadHash = this.hash({ operation: 'PROJECT_CREATE', input });
    const event = this.eventContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await this.findCommand(tx, organizationId, principal.userId, 'PROJECT_CREATE', key, payloadHash);
        if (replay) return this.getForResponse(tx, organizationId, replay.resourceId);
        await this.assertReferences(tx, organizationId, input.establishmentId, input.partyId, input.opportunityId);
        const id = randomUUID();
        const project = await tx.project.create({ data: { id, organizationId, establishmentId: input.establishmentId, partyId: input.partyId ?? null, opportunityId: input.opportunityId ?? null, name: input.name.trim(), description: input.description?.trim() ?? null, startsOn: dates.startsOn, dueOn: dates.dueOn, createdByUserId: principal.userId }, select: projectSelect });
        await this.createCommand(tx, { organizationId, actorUserId: principal.userId, operation: 'PROJECT_CREATE', key, payloadHash, resourceType: 'Project', resourceId: id, establishmentId: input.establishmentId });
        await this.recordMutation(tx, 'PROJECT_CREATED', 'project.created.v1', principal, organizationId, input.establishmentId, id, event, { name: project.name, status: project.status });
        return this.serialize(project);
      });
    } catch (error) {
      if (this.isUnique(error)) return this.replay(principal, organizationId, 'PROJECT_CREATE', key, payloadHash);
      if (this.isForeignKey(error)) throw new ConflictException('Project reference is invalid');
      throw error;
    }
  }

  async update(principal: AuthPrincipal, organizationId: string, projectId: string, input: UpdateProjectDto, rawKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'PROJECTS', 'projects:write');
    const current = await this.findScoped(context, organizationId, projectId);
    if (Object.keys(input).length === 0) throw new BadRequestException('At least one project field is required');
    if (current.status === 'COMPLETED' || current.status === 'CANCELLED') throw new ConflictException('Terminal projects are immutable');
    const dates = this.parseDates(input.startsOn, input.dueOn, current.startsOn, current.dueOn);
    const key = this.requireKey(rawKey);
    const payloadHash = this.hash({ operation: 'PROJECT_UPDATE', projectId, input });
    const event = this.eventContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await this.findCommand(tx, organizationId, principal.userId, 'PROJECT_UPDATE', key, payloadHash);
        if (replay) return this.getForResponse(tx, organizationId, replay.resourceId);
        await this.assertReferences(tx, organizationId, current.establishmentId, input.partyId === undefined ? current.partyId : input.partyId ?? undefined, input.opportunityId === undefined ? current.opportunityId : input.opportunityId ?? undefined);
        const changed = await tx.project.updateMany({ where: { id: projectId, organizationId, status: current.status }, data: { ...(input.name !== undefined ? { name: input.name.trim() } : {}), ...(input.description !== undefined ? { description: input.description?.trim() ?? null } : {}), ...(input.partyId !== undefined ? { partyId: input.partyId } : {}), ...(input.opportunityId !== undefined ? { opportunityId: input.opportunityId } : {}), ...(input.startsOn !== undefined ? { startsOn: dates.startsOn } : {}), ...(input.dueOn !== undefined ? { dueOn: dates.dueOn } : {}) } });
        if (changed.count === 0) throw new ConflictException('Project was changed concurrently');
        const project = await tx.project.findFirstOrThrow({ where: { id: projectId, organizationId }, select: projectSelect });
        await this.createCommand(tx, { organizationId, actorUserId: principal.userId, operation: 'PROJECT_UPDATE', key, payloadHash, resourceType: 'Project', resourceId: projectId, establishmentId: project.establishmentId });
        await this.recordMutation(tx, 'PROJECT_UPDATED', 'project.updated.v1', principal, organizationId, project.establishmentId, projectId, event, { fields: Object.keys(input) });
        return this.serialize(project);
      });
    } catch (error) {
      if (this.isUnique(error)) return this.replay(principal, organizationId, 'PROJECT_UPDATE', key, payloadHash, projectId);
      if (this.isForeignKey(error)) throw new ConflictException('Project reference is invalid');
      throw error;
    }
  }

  async transition(principal: AuthPrincipal, organizationId: string, projectId: string, input: TransitionProjectDto, rawKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'PROJECTS', 'projects:write');
    const current = await this.findScoped(context, organizationId, projectId);
    assertProjectTransition(current.status, input.status);
    const key = this.requireKey(rawKey);
    const payloadHash = this.hash({ operation: 'PROJECT_TRANSITION', projectId, input });
    const event = this.eventContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await this.findCommand(tx, organizationId, principal.userId, 'PROJECT_TRANSITION', key, payloadHash);
        if (replay) return this.getForResponse(tx, organizationId, replay.resourceId);
        const changed = await tx.project.updateMany({ where: { id: projectId, organizationId, status: current.status }, data: { status: input.status, ...(input.status === 'COMPLETED' ? { completedAt: new Date() } : {}), ...(input.status === 'CANCELLED' ? { cancelledAt: new Date() } : {}) } });
        if (changed.count === 0) throw new ConflictException('Project was changed concurrently');
        const project = await tx.project.findFirstOrThrow({ where: { id: projectId, organizationId }, select: projectSelect });
        await this.createCommand(tx, { organizationId, actorUserId: principal.userId, operation: 'PROJECT_TRANSITION', key, payloadHash, resourceType: 'Project', resourceId: projectId, establishmentId: project.establishmentId });
        await this.recordMutation(tx, 'PROJECT_STATUS_CHANGED', 'project.status_changed.v1', principal, organizationId, project.establishmentId, projectId, event, { previousStatus: current.status, status: project.status, reason: input.reason ?? null });
        return this.serialize(project);
      });
    } catch (error) {
      if (this.isUnique(error)) return this.replay(principal, organizationId, 'PROJECT_TRANSITION', key, payloadHash, projectId);
      throw error;
    }
  }

  private async findScoped(context: AuthorizationContext, organizationId: string, projectId: string): Promise<ProjectRow> {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, organizationId }, select: projectSelect });
    if (!project) throw new NotFoundException();
    await this.authorization.assertEstablishment(context, project.establishmentId);
    return project;
  }

  private async assertReferences(tx: Prisma.TransactionClient, organizationId: string, establishmentId: string, partyId?: string | null, opportunityId?: string | null): Promise<void> {
    if (partyId !== undefined && partyId !== null && !(await tx.businessParty.findFirst({ where: { id: partyId, organizationId, active: true }, select: { id: true } }))) throw new NotFoundException('Business party not found');
    if (opportunityId !== undefined && opportunityId !== null && !(await tx.opportunity.findFirst({ where: { id: opportunityId, organizationId, establishmentId }, select: { id: true } }))) throw new NotFoundException('Opportunity not found');
  }

  private async findCommand(tx: Prisma.TransactionClient, organizationId: string, actorUserId: string, operation: string, key: string, payloadHash: string): Promise<{ resourceId: string } | null> {
    const command = await tx.phase8IdempotencyKey.findUnique({ where: { organizationId_actorUserId_operation_key: { organizationId, actorUserId, operation, key } }, select: { resourceId: true, payloadHash: true } });
    if (!command) return null;
    if (command.payloadHash !== payloadHash) throw new ConflictException('Idempotency-Key was already used with a different command');
    return command;
  }

  private async createCommand(tx: Prisma.TransactionClient, input: { organizationId: string; actorUserId: string; operation: string; key: string; payloadHash: string; resourceType: string; resourceId: string; establishmentId: string }): Promise<void> {
    await tx.phase8IdempotencyKey.create({ data: { id: randomUUID(), ...input } });
  }

  private async replay(principal: AuthPrincipal, organizationId: string, operation: string, key: string, payloadHash: string, expectedResourceId?: string): Promise<unknown> {
    const command = await this.prisma.phase8IdempotencyKey.findUnique({ where: { organizationId_actorUserId_operation_key: { organizationId, actorUserId: principal.userId, operation, key } }, select: { resourceId: true, payloadHash: true } });
    if (!command || command.payloadHash !== payloadHash || (expectedResourceId !== undefined && command.resourceId !== expectedResourceId)) throw new ConflictException('Idempotency-Key could not be replayed');
    return this.getForResponse(this.prisma, organizationId, command.resourceId);
  }

  private async getForResponse(client: PrismaService | Prisma.TransactionClient, organizationId: string, projectId: string): Promise<unknown> {
    const project = await client.project.findFirstOrThrow({ where: { id: projectId, organizationId }, select: projectSelect });
    return this.serialize(project);
  }

  private async recordMutation(tx: Prisma.TransactionClient, action: AuditAction, eventType: string, principal: AuthPrincipal, organizationId: string, establishmentId: string, projectId: string, context: Context, payload: Record<string, unknown>): Promise<void> {
    await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, establishmentId, targetType: 'Project', targetId: projectId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'Project', id: projectId }, organizationId, establishmentId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'projects', payload }));
  }

  private parseDates(startsOn?: string | null, dueOn?: string | null, currentStartsOn?: Date | null, currentDueOn?: Date | null): { startsOn: Date | null; dueOn: Date | null } {
    const starts = startsOn === undefined ? currentStartsOn ?? null : startsOn === null ? null : this.dateOnly(startsOn);
    const due = dueOn === undefined ? currentDueOn ?? null : dueOn === null ? null : this.dateOnly(dueOn);
    if (starts && due && due < starts) throw new BadRequestException('dueOn cannot precede startsOn');
    return { startsOn: starts, dueOn: due };
  }

  private dateOnly(value: string): Date { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Date must be YYYY-MM-DD'); const date = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('Date is invalid'); return date; }
  private requireKey(value?: string): string { if (!value?.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new BadRequestException('Idempotency-Key is required and invalid'); return value.trim(); }
  private hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
  private eventContext(): Context { const context = currentEventContext(); return context?.requestId ? { requestId: context.requestId, correlationId: context.correlationId } : createRequestContext(); }
  private isUnique(error: unknown): boolean { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }
  private isForeignKey(error: unknown): boolean { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003'; }
  private encodeCursor(cursor: Cursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }
  private decodeCursor(value: string): Cursor { try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>; if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') throw new Error(); return { createdAt: parsed.createdAt, id: parsed.id }; } catch { throw new BadRequestException('Cursor is invalid'); } }
  private serialize(project: ProjectRow): unknown { return { ...project, startsOn: project.startsOn?.toISOString().slice(0, 10) ?? null, dueOn: project.dueOn?.toISOString().slice(0, 10) ?? null, createdAt: project.createdAt.toISOString(), updatedAt: project.updatedAt.toISOString(), completedAt: project.completedAt?.toISOString() ?? null, cancelledAt: project.cancelledAt?.toISOString() ?? null }; }
}
