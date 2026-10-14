import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction, type ExpenseStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import type { CreateExpenseDto, ExpenseListQuery, RecordExpenseDto, UpdateExpenseDto, VoidExpenseDto } from './expense.dto.js';

type ExpenseCursor = { createdAt: string; id: string };
type CommandContext = { requestId: string; correlationId: string };
const currencyPattern = /^[A-Z]{3}$/;

@Injectable()
export class ExpenseService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter) {}

  async list(principal: AuthPrincipal, organizationId: string, query: ExpenseListQuery): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'EXPENSES', 'expenses:read');
    if (query.establishmentId) await this.authorization.assertEstablishment(context, query.establishmentId);
    const establishmentIds = query.establishmentId ? [query.establishmentId] : context.scopeMode === 'SELECTED_ESTABLISHMENTS' ? Array.from(context.establishmentIds) : undefined;
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.prisma.expense.findMany({
      where: { organizationId, ...(establishmentIds ? { establishmentId: { in: establishmentIds } } : {}), ...(query.status ? { status: query.status } : {}), ...(cursor ? { OR: [{ createdAt: { gt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }] } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: this.select,
    });
    const items = rows.slice(0, limit).map((expense) => this.serialize(expense));
    const next = rows.length > limit ? rows[limit - 1] : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ createdAt: next.createdAt.toISOString(), id: next.id }) : null };
  }

  async get(principal: AuthPrincipal, organizationId: string, expenseId: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'EXPENSES', 'expenses:read');
    const expense = await this.prisma.expense.findFirst({ where: { id: expenseId, organizationId }, select: this.select });
    if (!expense) throw new NotFoundException();
    await this.authorization.assertEstablishment(context, expense.establishmentId);
    return this.serialize(expense);
  }

  async create(principal: AuthPrincipal, organizationId: string, input: CreateExpenseDto, rawIdempotencyKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'EXPENSES', 'expenses:write');
    await this.authorization.assertEstablishment(context, input.establishmentId);
    this.validateCreate(input);
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    const payloadHash = this.hash({ operation: 'EXPENSE_CREATE', input });
    const eventContext = this.eventContext();
    const id = randomUUID();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await this.findCommand(tx, organizationId, principal.userId, 'EXPENSE_CREATE', idempotencyKey, payloadHash);
        if (replay) return this.getCommandExpense(replay.expenseId, organizationId, tx);
        await this.assertParty(tx, organizationId, input.partyId);
        const expense = await tx.expense.create({ data: { id, organizationId, establishmentId: input.establishmentId, description: input.description.trim(), category: input.category.trim(), amount: input.amount, currency: input.currency, expenseDate: this.dateOnly(input.expenseDate), partyId: input.partyId ?? null, createdByUserId: principal.userId }, select: this.select });
        await this.createCommand(tx, { organizationId, actorUserId: principal.userId, operation: 'EXPENSE_CREATE', key: idempotencyKey, payloadHash, establishmentId: expense.establishmentId, expenseId: expense.id });
        await this.recordMutation(tx, 'EXPENSE_CREATED', 'expenses.created', principal, organizationId, expense.establishmentId, expense.id, eventContext, this.eventPayload(expense));
        return this.serialize(expense);
      });
    } catch (error) {
      if (this.isUnique(error)) return this.replayCommand(principal, organizationId, 'EXPENSE_CREATE', idempotencyKey, payloadHash);
      if (this.isForeignKey(error)) throw new ConflictException('Expense reference is invalid');
      throw error;
    }
  }

  async update(principal: AuthPrincipal, organizationId: string, expenseId: string, input: UpdateExpenseDto, rawIdempotencyKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'EXPENSES', 'expenses:write');
    const current = await this.findScoped(context, organizationId, expenseId);
    if (Object.keys(input).length === 0) throw new BadRequestException('At least one expense field is required');
    this.validateUpdate(input);
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    const payloadHash = this.hash({ operation: 'EXPENSE_UPDATE', expenseId, input });
    const eventContext = this.eventContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await this.findCommand(tx, organizationId, principal.userId, 'EXPENSE_UPDATE', idempotencyKey, payloadHash);
        if (replay) return this.getCommandExpense(replay.expenseId, organizationId, tx);
        if (current.status !== 'DRAFT') throw new ConflictException('Only draft expenses can be updated; recorded expenses are immutable');
        await this.assertParty(tx, organizationId, input.partyId);
        const changed = await tx.expense.updateMany({ where: { id: expenseId, organizationId, status: 'DRAFT' }, data: { ...(input.description !== undefined ? { description: input.description.trim() } : {}), ...(input.category !== undefined ? { category: input.category.trim() } : {}), ...(input.expenseDate !== undefined ? { expenseDate: this.dateOnly(input.expenseDate) } : {}), ...(input.partyId !== undefined ? { partyId: input.partyId } : {}) } });
        if (changed.count === 0) throw new ConflictException('Expense was changed concurrently');
        const expense = await tx.expense.findFirstOrThrow({ where: { id: expenseId, organizationId }, select: this.select });
        await this.createCommand(tx, { organizationId, actorUserId: principal.userId, operation: 'EXPENSE_UPDATE', key: idempotencyKey, payloadHash, establishmentId: expense.establishmentId, expenseId });
        await this.recordMutation(tx, 'EXPENSE_UPDATED', 'expenses.updated', principal, organizationId, expense.establishmentId, expense.id, eventContext, { fields: Object.keys(input), status: expense.status });
        return this.serialize(expense);
      });
    } catch (error) {
      if (this.isUnique(error)) return this.replayCommand(principal, organizationId, 'EXPENSE_UPDATE', idempotencyKey, payloadHash, expenseId);
      if (this.isForeignKey(error)) throw new ConflictException('Expense reference is invalid');
      throw error;
    }
  }

  async record(principal: AuthPrincipal, organizationId: string, expenseId: string, _input: RecordExpenseDto, rawIdempotencyKey?: string): Promise<unknown> {
    return this.transition(principal, organizationId, expenseId, 'RECORDED', {}, 'EXPENSE_RECORD', 'EXPENSE_RECORDED', 'expenses.recorded', rawIdempotencyKey);
  }

  async void(principal: AuthPrincipal, organizationId: string, expenseId: string, input: VoidExpenseDto, rawIdempotencyKey?: string): Promise<unknown> {
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException('Void reason is required');
    return this.transition(principal, organizationId, expenseId, 'VOID', { reason }, 'EXPENSE_VOID', 'EXPENSE_VOIDED', 'expenses.voided', rawIdempotencyKey);
  }

  private async transition(principal: AuthPrincipal, organizationId: string, expenseId: string, target: ExpenseStatus, payload: Record<string, unknown>, operation: string, action: AuditAction, eventType: string, rawIdempotencyKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'EXPENSES', 'expenses:write');
    const current = await this.findScoped(context, organizationId, expenseId);
    const idempotencyKey = this.requireIdempotencyKey(rawIdempotencyKey);
    const payloadHash = this.hash({ operation, expenseId, payload });
    const eventContext = this.eventContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await this.findCommand(tx, organizationId, principal.userId, operation, idempotencyKey, payloadHash);
        if (replay) return this.getCommandExpense(replay.expenseId, organizationId, tx);
        if ((target === 'RECORDED' && current.status !== 'DRAFT') || (target === 'VOID' && current.status !== 'RECORDED')) throw new ConflictException(`Expense cannot transition from ${current.status} to ${target}`);
        const changed = await tx.expense.updateMany({ where: { id: expenseId, organizationId, status: current.status }, data: { status: target, ...(target === 'VOID' ? { voidReason: String(payload.reason) } : {}) } });
        if (changed.count === 0) throw new ConflictException('Expense was changed concurrently');
        const expense = await tx.expense.findFirstOrThrow({ where: { id: expenseId, organizationId }, select: this.select });
        await this.createCommand(tx, { organizationId, actorUserId: principal.userId, operation, key: idempotencyKey, payloadHash, establishmentId: expense.establishmentId, expenseId });
        await this.recordMutation(tx, action, eventType, principal, organizationId, expense.establishmentId, expense.id, eventContext, { ...this.eventPayload(expense), ...(target === 'VOID' ? { reason: expense.voidReason } : {}) });
        return this.serialize(expense);
      });
    } catch (error) {
      if (this.isUnique(error)) return this.replayCommand(principal, organizationId, operation, idempotencyKey, payloadHash, expenseId);
      throw error;
    }
  }

  private async findScoped(context: { establishmentIds: readonly string[]; scopeMode: string }, organizationId: string, expenseId: string): Promise<{ id: string; establishmentId: string; status: ExpenseStatus }> {
    const expense = await this.prisma.expense.findFirst({ where: { id: expenseId, organizationId }, select: { id: true, establishmentId: true, status: true } });
    if (!expense) throw new NotFoundException();
    if (context.scopeMode === 'SELECTED_ESTABLISHMENTS' && !context.establishmentIds.includes(expense.establishmentId)) throw new ConflictException('Expense is outside the establishment scope');
    return expense;
  }

  private async assertParty(tx: Prisma.TransactionClient, organizationId: string, partyId?: string | null): Promise<void> {
    if (partyId === undefined || partyId === null) return;
    const party = await tx.businessParty.findFirst({ where: { id: partyId, organizationId }, select: { id: true } });
    if (!party) throw new NotFoundException('Business party not found');
  }

  private async findCommand(tx: Prisma.TransactionClient, organizationId: string, actorUserId: string, operation: string, key: string, payloadHash: string): Promise<{ expenseId: string } | null> {
    const command = await tx.expenseIdempotencyKey.findUnique({ where: { organizationId_actorUserId_operation_key: { organizationId, actorUserId, operation, key } }, select: { expenseId: true, payloadHash: true } });
    if (!command) return null;
    if (command.payloadHash !== payloadHash) throw new ConflictException('Idempotency-Key was already used with a different command');
    return command;
  }

  private async createCommand(tx: Prisma.TransactionClient, command: { organizationId: string; actorUserId: string; operation: string; key: string; payloadHash: string; establishmentId: string; expenseId: string }): Promise<void> {
    await tx.expenseIdempotencyKey.create({ data: { id: randomUUID(), ...command } });
  }

  private async replayCommand(principal: AuthPrincipal, organizationId: string, operation: string, key: string, payloadHash: string, expectedExpenseId?: string): Promise<unknown> {
    const command = await this.prisma.expenseIdempotencyKey.findUnique({ where: { organizationId_actorUserId_operation_key: { organizationId, actorUserId: principal.userId, operation, key } }, select: { expenseId: true, payloadHash: true } });
    if (!command || (expectedExpenseId !== undefined && command.expenseId !== expectedExpenseId)) throw new ConflictException('Idempotency-Key could not be replayed');
    if (command.payloadHash !== payloadHash) throw new ConflictException('Idempotency-Key was already used with a different command');
    return this.getForResponse(organizationId, command.expenseId);
  }

  private async getCommandExpense(expenseId: string, organizationId: string, tx: Prisma.TransactionClient): Promise<unknown> {
    const expense = await tx.expense.findFirstOrThrow({ where: { id: expenseId, organizationId }, select: this.select });
    return this.serialize(expense);
  }

  private async getForResponse(organizationId: string, expenseId: string): Promise<unknown> {
    const expense = await this.prisma.expense.findFirst({ where: { id: expenseId, organizationId }, select: this.select });
    if (!expense) throw new NotFoundException();
    return this.serialize(expense);
  }

  private async recordMutation(tx: Prisma.TransactionClient, action: AuditAction, eventType: string, principal: AuthPrincipal, organizationId: string, establishmentId: string, expenseId: string, context: CommandContext, payload: Record<string, unknown>): Promise<void> {
    await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, establishmentId, targetType: 'Expense', targetId: expenseId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'Expense', id: expenseId }, organizationId, establishmentId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'operations-expense', payload }));
  }

  private eventContext(): CommandContext {
    const eventContext = currentEventContext();
    return eventContext?.requestId ? { requestId: eventContext.requestId, correlationId: eventContext.correlationId } : createRequestContext();
  }

  private validateCreate(input: CreateExpenseDto): void {
    if (!input.description.trim() || !input.category.trim()) throw new BadRequestException('Description and category are required');
    if (new Prisma.Decimal(input.amount).lte(0)) throw new BadRequestException('Amount must be positive');
    if (!currencyPattern.test(input.currency)) throw new BadRequestException('Currency must be three uppercase letters');
    this.dateOnly(input.expenseDate);
  }

  private validateUpdate(input: UpdateExpenseDto): void {
    if (input.description !== undefined && !input.description.trim()) throw new BadRequestException('Description cannot be empty');
    if (input.category !== undefined && !input.category.trim()) throw new BadRequestException('Category cannot be empty');
    if (input.expenseDate !== undefined) this.dateOnly(input.expenseDate);
  }

  private dateOnly(value: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Expense date must be YYYY-MM-DD');
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('Expense date is invalid');
    return date;
  }

  private requireIdempotencyKey(value?: string): string {
    if (!value || !value.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new BadRequestException('Idempotency-Key is required and invalid');
    return value.trim();
  }

  private hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

  private isUnique(error: unknown): boolean { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }

  private isForeignKey(error: unknown): boolean { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003'; }

  private eventPayload(expense: { id: string; status: ExpenseStatus; description: string; category: string; amount: Prisma.Decimal; currency: string; expenseDate: Date; partyId: string | null }): Record<string, unknown> {
    return { expenseId: expense.id, status: expense.status, description: expense.description, category: expense.category, amount: expense.amount.toFixed(4), currency: expense.currency, expenseDate: expense.expenseDate.toISOString().slice(0, 10), partyId: expense.partyId };
  }

  private readonly select = { id: true, organizationId: true, establishmentId: true, status: true, description: true, category: true, amount: true, currency: true, expenseDate: true, partyId: true, voidReason: true, createdByUserId: true, createdAt: true, updatedAt: true } as const;

  private serialize(expense: { id: string; organizationId: string; establishmentId: string; status: ExpenseStatus; description: string; category: string; amount: Prisma.Decimal; currency: string; expenseDate: Date; partyId: string | null; voidReason: string | null; createdByUserId: string; createdAt: Date; updatedAt: Date }): unknown {
    return { ...expense, amount: expense.amount.toFixed(4), expenseDate: expense.expenseDate.toISOString().slice(0, 10), createdAt: expense.createdAt.toISOString(), updatedAt: expense.updatedAt.toISOString() };
  }

  private encodeCursor(cursor: ExpenseCursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }

  private decodeCursor(value: string): ExpenseCursor {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<ExpenseCursor>;
      if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || Number.isNaN(Date.parse(parsed.createdAt))) throw new Error('invalid');
      return { createdAt: parsed.createdAt, id: parsed.id };
    } catch { throw new BadRequestException('Cursor is invalid'); }
  }
}
