import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction, type CashAccountStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import type { CashAccountListQuery, ChangeCashAccountStatusDto, CreateCashAccountDto, UpdateCashAccountDto } from './cash.dto.js';

type Cursor = { createdAt: string; id: string };
type Context = { requestId: string; correlationId: string };
const select = { id: true, organizationId: true, establishmentId: true, code: true, name: true, currency: true, status: true, createdByUserId: true, createdAt: true, updatedAt: true } as const;
type Account = Prisma.CashAccountGetPayload<{ select: typeof select }>;

@Injectable()
export class CashAccountService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter) {}

  async list(principal: AuthPrincipal, organizationId: string, query: CashAccountListQuery): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'CASH', 'cash:read');
    if (query.establishmentId) await this.authorization.assertEstablishment(context, query.establishmentId);
    const establishments = query.establishmentId ? [query.establishmentId] : context.scopeMode === 'SELECTED_ESTABLISHMENTS' ? Array.from(context.establishmentIds) : undefined;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.prisma.cashAccount.findMany({ where: { organizationId, ...(establishments ? { establishmentId: { in: establishments } } : {}), ...(query.status ? { status: query.status } : {}), ...(cursor ? { OR: [{ createdAt: { gt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }] } : {}) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: (query.limit ?? 20) + 1, select });
    const limit = query.limit ?? 20;
    const items = await Promise.all(rows.slice(0, limit).map((account) => this.serialize(account)));
    const next = rows.length > limit ? rows[limit - 1] : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ createdAt: next.createdAt.toISOString(), id: next.id }) : null };
  }

  async get(principal: AuthPrincipal, organizationId: string, accountId: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'CASH', 'cash:read');
    const account = await this.prisma.cashAccount.findFirst({ where: { id: accountId, organizationId }, select });
    if (!account) throw new NotFoundException('Cash account not found');
    await this.authorization.assertEstablishment(context, account.establishmentId);
    return this.serialize(account);
  }

  async create(principal: AuthPrincipal, organizationId: string, input: CreateCashAccountDto, rawKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'CASH', 'cash:write');
    await this.authorization.assertEstablishment(context, input.establishmentId);
    this.validateAccount(input);
    const key = this.key(rawKey);
    const hash = this.hash({ operation: 'CASH_ACCOUNT_CREATE', input });
    const event = this.eventContext();
    const id = randomUUID();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await this.findCommand(tx, organizationId, principal.userId, 'CASH_ACCOUNT_CREATE', key, hash);
        if (existing) return this.responseFromTx(tx, organizationId, existing.cashAccountId);
        const account = await tx.cashAccount.create({ data: { id, organizationId, establishmentId: input.establishmentId, code: input.code.trim(), name: input.name.trim(), currency: input.currency, createdByUserId: principal.userId }, select });
        await tx.cashAccountIdempotencyKey.create({ data: { id: randomUUID(), organizationId, actorUserId: principal.userId, operation: 'CASH_ACCOUNT_CREATE', key, payloadHash: hash, establishmentId: account.establishmentId, cashAccountId: account.id } });
        await this.mutate(tx, 'CASH_ACCOUNT_CREATED', 'cash.account.created', principal, organizationId, account.establishmentId, account.id, event, { accountId: account.id, code: account.code, currency: account.currency });
        return this.serialize(account);
      });
    } catch (error) {
      if (this.unique(error)) return this.replay(principal, organizationId, 'CASH_ACCOUNT_CREATE', key, hash);
      if (this.foreignKey(error)) throw new ConflictException('Cash account reference is invalid');
      throw error;
    }
  }

  async update(principal: AuthPrincipal, organizationId: string, accountId: string, input: UpdateCashAccountDto, rawKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'CASH', 'cash:write');
    const current = await this.prisma.cashAccount.findFirst({ where: { id: accountId, organizationId }, select });
    if (!current) throw new NotFoundException('Cash account not found');
    await this.authorization.assertEstablishment(context, current.establishmentId);
    if (!input.name?.trim()) throw new BadRequestException('Account name is required');
    const key = this.key(rawKey); const hash = this.hash({ operation: 'CASH_ACCOUNT_UPDATE', accountId, input }); const event = this.eventContext();
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.findCommand(tx, organizationId, principal.userId, 'CASH_ACCOUNT_UPDATE', key, hash);
      if (existing) return this.responseFromTx(tx, organizationId, existing.cashAccountId);
      const account = await tx.cashAccount.update({ where: { id: accountId }, data: { name: input.name!.trim() }, select });
      await tx.cashAccountIdempotencyKey.create({ data: { id: randomUUID(), organizationId, actorUserId: principal.userId, operation: 'CASH_ACCOUNT_UPDATE', key, payloadHash: hash, establishmentId: account.establishmentId, cashAccountId: account.id } });
      await this.mutate(tx, 'CASH_ACCOUNT_UPDATED', 'cash.account.updated', principal, organizationId, account.establishmentId, account.id, event, { accountId: account.id, fields: ['name'] });
      return this.serialize(account);
    });
  }

  deactivate(principal: AuthPrincipal, organizationId: string, accountId: string, input: ChangeCashAccountStatusDto, key?: string): Promise<unknown> { return this.changeStatus(principal, organizationId, accountId, 'INACTIVE', input, key); }
  reactivate(principal: AuthPrincipal, organizationId: string, accountId: string, input: ChangeCashAccountStatusDto, key?: string): Promise<unknown> { return this.changeStatus(principal, organizationId, accountId, 'ACTIVE', input, key); }

  private async changeStatus(principal: AuthPrincipal, organizationId: string, accountId: string, status: CashAccountStatus, input: ChangeCashAccountStatusDto, rawKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'CASH', 'cash:write');
    if (!input.reason?.trim()) throw new BadRequestException('Reason is required');
    const current = await this.prisma.cashAccount.findFirst({ where: { id: accountId, organizationId }, select });
    if (!current) throw new NotFoundException('Cash account not found');
    await this.authorization.assertEstablishment(context, current.establishmentId);
    if (current.status === status) return this.serialize(current);
    const operation = status === 'ACTIVE' ? 'CASH_ACCOUNT_REACTIVATE' : 'CASH_ACCOUNT_DEACTIVATE';
    const action: AuditAction = status === 'ACTIVE' ? 'CASH_ACCOUNT_REACTIVATED' : 'CASH_ACCOUNT_DEACTIVATED';
    const eventType = status === 'ACTIVE' ? 'cash.account.reactivated' : 'cash.account.deactivated';
    const key = this.key(rawKey); const hash = this.hash({ operation, accountId, status, reason: input.reason.trim() }); const event = this.eventContext();
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.findCommand(tx, organizationId, principal.userId, operation, key, hash);
      if (existing) return this.responseFromTx(tx, organizationId, existing.cashAccountId);
      const changed = await tx.cashAccount.updateMany({ where: { id: accountId, organizationId, status: current.status }, data: { status } });
      if (!changed.count) throw new ConflictException('Cash account was changed concurrently');
      const account = await tx.cashAccount.findFirstOrThrow({ where: { id: accountId, organizationId }, select });
      await tx.cashAccountIdempotencyKey.create({ data: { id: randomUUID(), organizationId, actorUserId: principal.userId, operation, key, payloadHash: hash, establishmentId: account.establishmentId, cashAccountId: account.id } });
      await this.mutate(tx, action, eventType, principal, organizationId, account.establishmentId, account.id, event, { accountId: account.id, previousStatus: current.status, status, reason: input.reason.trim() });
      return this.serialize(account);
    });
  }

  private async serialize(account: Account): Promise<unknown> { const [ins, outs] = await Promise.all([this.prisma.cashMovement.aggregate({ where: { organizationId: account.organizationId, cashAccountId: account.id, direction: 'IN' }, _sum: { amount: true } }), this.prisma.cashMovement.aggregate({ where: { organizationId: account.organizationId, cashAccountId: account.id, direction: 'OUT' }, _sum: { amount: true } })]); return this.serialized(account, (ins._sum.amount ?? new Prisma.Decimal(0)).sub(outs._sum.amount ?? new Prisma.Decimal(0))); }
  private async responseFromTx(tx: Prisma.TransactionClient, organizationId: string, id: string): Promise<unknown> { const account = await tx.cashAccount.findFirstOrThrow({ where: { id, organizationId }, select }); const [ins, outs] = await Promise.all([tx.cashMovement.aggregate({ where: { organizationId, cashAccountId: id, direction: 'IN' }, _sum: { amount: true } }), tx.cashMovement.aggregate({ where: { organizationId, cashAccountId: id, direction: 'OUT' }, _sum: { amount: true } })]); return this.serialized(account, (ins._sum.amount ?? new Prisma.Decimal(0)).sub(outs._sum.amount ?? new Prisma.Decimal(0))); }
  private serialized(account: Account, balance: Prisma.Decimal): unknown { return { id: account.id, organizationId: account.organizationId, establishmentId: account.establishmentId, code: account.code, name: account.name, currency: account.currency.trim(), status: account.status, balance: balance.toFixed(4), createdAt: account.createdAt.toISOString(), updatedAt: account.updatedAt.toISOString() }; }
  private async findCommand(tx: Prisma.TransactionClient, organizationId: string, actorUserId: string, operation: string, key: string, payloadHash: string): Promise<{ cashAccountId: string } | null> { const row = await tx.cashAccountIdempotencyKey.findUnique({ where: { organizationId_actorUserId_operation_key: { organizationId, actorUserId, operation, key } }, select: { cashAccountId: true, payloadHash: true } }); if (!row) return null; if (row.payloadHash !== payloadHash) throw new ConflictException('Idempotency-Key was already used with a different command'); return row; }
  private async replay(principal: AuthPrincipal, organizationId: string, operation: string, key: string, hash: string): Promise<unknown> { const row = await this.prisma.cashAccountIdempotencyKey.findUnique({ where: { organizationId_actorUserId_operation_key: { organizationId, actorUserId: principal.userId, operation, key } }, select: { cashAccountId: true, payloadHash: true } }); if (!row || row.payloadHash !== hash) throw new ConflictException('Idempotency-Key could not be replayed'); return this.get(principal, organizationId, row.cashAccountId); }
  private async mutate(tx: Prisma.TransactionClient, action: AuditAction, eventType: string, principal: AuthPrincipal, organizationId: string, establishmentId: string, id: string, context: Context, payload: Record<string, unknown>): Promise<void> { await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, establishmentId, targetType: 'CashAccount', targetId: id, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } }); await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'CashAccount', id }, organizationId, establishmentId, correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'cash-operations', payload })); }
  private validateAccount(input: CreateCashAccountDto): void { if (!input.name.trim()) throw new BadRequestException('Account name is required'); if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(input.code)) throw new BadRequestException('Account code is invalid'); if (!/^[A-Z]{3}$/.test(input.currency)) throw new BadRequestException('Currency is invalid'); }
  private key(value?: string): string { if (!value?.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new BadRequestException('Idempotency-Key is required and invalid'); return value.trim(); }
  private hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
  private eventContext(): Context { const current = currentEventContext(); return current?.requestId ? { requestId: current.requestId, correlationId: current.correlationId } : createRequestContext(); }
  private unique(error: unknown): boolean { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }
  private foreignKey(error: unknown): boolean { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003'; }
  private encodeCursor(cursor: Cursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }
  private decodeCursor(value: string): Cursor { try { const p = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>; if (!p.id || !p.createdAt || Number.isNaN(Date.parse(p.createdAt))) throw new Error(); return { id: p.id, createdAt: p.createdAt }; } catch { throw new BadRequestException('Cursor is invalid'); } }
}
