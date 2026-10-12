import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import type { CreateWarehouseDto, UpdateWarehouseDto, WarehouseListQuery } from './warehouse.dto.js';

type WarehouseCursor = { createdAt: string; id: string };

@Injectable()
export class WarehouseService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter) {}

  async list(principal: AuthPrincipal, organizationId: string, establishmentId: string, query: WarehouseListQuery): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'INVENTORY', 'inventory:read');
    await this.authorization.assertEstablishment(context, establishmentId);
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.prisma.warehouse.findMany({
      where: {
        organizationId,
        establishmentId,
        ...(query.active === undefined ? {} : { active: query.active }),
        ...(cursor ? { OR: [{ createdAt: { gt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: this.select,
    });
    const items = rows.slice(0, limit).map((warehouse) => this.serialize(warehouse));
    const next = rows.length > limit ? rows[limit - 1] : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ createdAt: next.createdAt.toISOString(), id: next.id }) : null };
  }

  async get(principal: AuthPrincipal, organizationId: string, establishmentId: string, warehouseId: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'INVENTORY', 'inventory:read');
    await this.authorization.assertEstablishment(context, establishmentId);
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: warehouseId, organizationId, establishmentId }, select: this.select });
    if (!warehouse) throw new NotFoundException();
    return this.serialize(warehouse);
  }

  async create(principal: AuthPrincipal, organizationId: string, establishmentId: string, input: CreateWarehouseDto): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'INVENTORY', 'inventory:write');
    await this.authorization.assertEstablishment(context, establishmentId);
    const id = randomUUID();
    const eventContext = currentEventContext();
    const event = eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const warehouse = await tx.warehouse.create({ data: { id, organizationId, establishmentId, code: this.normalizeCode(input.code), name: input.name.trim() }, select: this.select });
        await this.recordMutation(tx, 'WAREHOUSE_CREATED', 'warehouse.created', principal, organizationId, establishmentId, id, event, { code: warehouse.code, name: warehouse.name });
        return this.serialize(warehouse);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Warehouse code already exists in this organization');
      throw error;
    }
  }

  async update(principal: AuthPrincipal, organizationId: string, establishmentId: string, warehouseId: string, input: UpdateWarehouseDto): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'INVENTORY', 'inventory:write');
    await this.authorization.assertEstablishment(context, establishmentId);
    if (Object.keys(input).length === 0) throw new BadRequestException('At least one warehouse field is required');
    const current = await this.prisma.warehouse.findFirst({ where: { id: warehouseId, organizationId, establishmentId }, select: { id: true } });
    if (!current) throw new NotFoundException();
    const eventContext = currentEventContext();
    const event = eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const warehouse = await tx.warehouse.update({ where: { id: warehouseId }, data: { ...(input.code !== undefined ? { code: this.normalizeCode(input.code) } : {}), ...(input.name !== undefined ? { name: input.name.trim() } : {}) }, select: this.select });
        await this.recordMutation(tx, 'WAREHOUSE_UPDATED', 'warehouse.updated', principal, organizationId, establishmentId, warehouseId, event, { fields: Object.keys(input) });
        return this.serialize(warehouse);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Warehouse code already exists in this organization');
      throw error;
    }
  }

  async setActive(principal: AuthPrincipal, organizationId: string, establishmentId: string, warehouseId: string, active: boolean): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'INVENTORY', 'inventory:write');
    await this.authorization.assertEstablishment(context, establishmentId);
    const eventContext = currentEventContext();
    const event = eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext();
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.warehouse.findFirst({ where: { id: warehouseId, organizationId, establishmentId }, select: this.select });
      if (!current) throw new NotFoundException();
      if (current.active === active) return this.serialize(current);
      const warehouse = await tx.warehouse.update({ where: { id: warehouseId }, data: { active }, select: this.select });
      await this.recordMutation(tx, 'WAREHOUSE_STATUS_CHANGED', 'warehouse.status_changed', principal, organizationId, establishmentId, warehouseId, event, { active });
      return this.serialize(warehouse);
    });
  }

  private async recordMutation(tx: Prisma.TransactionClient, action: AuditAction, eventType: string, principal: AuthPrincipal, organizationId: string, establishmentId: string, warehouseId: string, context: { requestId: string; correlationId: string }, payload: Record<string, unknown>): Promise<void> {
    await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, establishmentId, targetType: 'Warehouse', targetId: warehouseId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'Warehouse', id: warehouseId }, organizationId, establishmentId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'warehouse-referential', payload }));
  }

  private readonly select = { id: true, organizationId: true, establishmentId: true, code: true, name: true, active: true, createdAt: true, updatedAt: true } as const;

  private serialize(warehouse: { id: string; organizationId: string; establishmentId: string; code: string; name: string; active: boolean; createdAt: Date; updatedAt: Date }): unknown {
    return { ...warehouse, createdAt: warehouse.createdAt.toISOString(), updatedAt: warehouse.updatedAt.toISOString() };
  }

  private normalizeCode(value: string): string { return value.trim().toUpperCase(); }

  private encodeCursor(cursor: WarehouseCursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }

  private decodeCursor(value: string): WarehouseCursor {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<WarehouseCursor>;
      if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || Number.isNaN(Date.parse(parsed.createdAt))) throw new Error('invalid');
      return { createdAt: parsed.createdAt, id: parsed.id };
    } catch {
      throw new BadRequestException('Cursor is invalid');
    }
  }
}
