import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext, type EventContext } from '../events/event-context.js';
import { SubscriptionService } from './subscription.service.js';

export interface ReserveQuotaInput {
  organizationId: string;
  quotaCode: string;
  amount: bigint;
  idempotencyKey: string;
  at?: Date;
}

export interface ConsumeQuotaInput {
  organizationId: string;
  quotaCode: string;
  amount: bigint;
  idempotencyKey: string;
  resourceType: string;
  resourceId: string;
  at?: Date;
}

export interface ReconcileCapacityInput extends ConsumeQuotaInput {
  direction: 'INCREASE' | 'DECREASE';
}

export interface QuotaReservationResult {
  id: string;
  organizationId: string;
  quotaCode: string;
  periodKey: string;
  amount: bigint;
  limit: bigint;
  status: 'HELD' | 'COMMITTED' | 'RELEASED';
}

type QuotaMode = 'CAPACITY' | 'PERIODIC';
type QuotaDefinition = { quotaCode: string; unit: 'COUNT' | 'BYTES'; mode: QuotaMode; limitValue: bigint };

@Injectable()
export class QuotaService {
  constructor(private readonly prisma: PrismaService, private readonly subscriptions: SubscriptionService, private readonly outbox: PrismaOutboxWriter) {}

  async reserve(input: ReserveQuotaInput): Promise<QuotaReservationResult> {
    this.assertInput(input);
    const at = input.at ?? new Date();
    const subscription = await this.subscriptions.resolveEffective(input.organizationId, at);
    if (!subscription) throw new ConflictException('Organization has no active subscription');
    const plan = await this.prisma.planVersion.findUniqueOrThrow({ where: { id: subscription.planVersionId }, select: { billingPeriod: true, planCode: true, currency: true } });
    if (input.quotaCode === 'MAX_USERS' && plan.planCode !== 'CONNECT' && plan.currency === 'USD') return this.unlimitedResult(input);
    const quota = await this.prisma.planVersionQuota.findUnique({ where: { planVersionId_quotaCode: { planVersionId: subscription.planVersionId, quotaCode: input.quotaCode } } });
    if (!quota) throw new ConflictException('Quota is not included in the active plan');
    const periodKey = this.periodKey(quota.mode, plan.billingPeriod, at);
    const existing = await this.prisma.quotaReservation.findUnique({ where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey } } });
    if (existing) {
      if (existing.quotaCode !== input.quotaCode || existing.periodKey !== periodKey || existing.amount !== input.amount) throw new ConflictException('Quota idempotency key was already used with different parameters');
      return this.result(existing);
    }
    const limit = await this.effectiveLimit(this.prisma, input.organizationId, input.quotaCode, quota.limitValue, at);
    const context = currentEventContext() ?? createRequestContext();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const usageId = randomUUID();
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "organization_quota_usages" ("id", "organization_id", "quota_code", "period_key", "limit_value")
          VALUES (${usageId}::uuid, ${input.organizationId}::uuid, ${input.quotaCode}, ${periodKey}, ${limit})
          ON CONFLICT ("organization_id", "quota_code", "period_key") DO NOTHING
        `);
        await tx.$executeRaw(Prisma.sql`
          UPDATE "organization_quota_usages" SET "limit_value" = ${limit}, "updated_at" = CURRENT_TIMESTAMP
          WHERE "organization_id" = ${input.organizationId}::uuid AND "quota_code" = ${input.quotaCode} AND "period_key" = ${periodKey}
        `);
        const changed = await tx.$executeRaw(Prisma.sql`
          UPDATE "organization_quota_usages"
          SET "reserved_value" = "reserved_value" + ${input.amount}, "updated_at" = CURRENT_TIMESTAMP
          WHERE "organization_id" = ${input.organizationId}::uuid
            AND "quota_code" = ${input.quotaCode}
            AND "period_key" = ${periodKey}
            AND "used_value" + "reserved_value" + ${input.amount} <= "limit_value"
        `);
        if (changed !== 1) throw new ConflictException('Quota capacity exceeded');
        const reservation = await tx.quotaReservation.create({ data: { id: randomUUID(), organizationId: input.organizationId, quotaCode: input.quotaCode, periodKey, amount: input.amount, limitValue: limit, status: 'HELD', idempotencyKey: input.idempotencyKey } });
        await this.recordMutation(tx, 'QUOTA_RESERVED', 'quota.reserved', reservation, context, { amount: input.amount.toString() });
        return this.result(reservation);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.quotaReservation.findUnique({ where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey } } });
        if (existing && existing.quotaCode === input.quotaCode && existing.periodKey === periodKey && existing.amount === input.amount) return this.result(existing);
      }
      throw error;
    }
  }

  async consume(tx: Prisma.TransactionClient, input: ConsumeQuotaInput): Promise<QuotaReservationResult> {
    this.assertInput(input);
    if (!input.resourceType.trim() || !input.resourceId.trim()) throw new BadRequestException('Quota resource is invalid');
    const at = input.at ?? new Date();
    const subscription = await tx.subscription.findFirst({ where: { organizationId: input.organizationId, organization: { status: 'ACTIVE' }, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] }, startsAt: { lte: at }, OR: [{ endsAt: null }, { endsAt: { gt: at } }] }, orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }], select: { planVersion: { select: { id: true, planCode: true, currency: true, billingPeriod: true } } } });
    if (!subscription) throw new ConflictException('Organization has no active subscription');
    const plan = subscription.planVersion;
    if (input.quotaCode === 'MAX_USERS' && plan.planCode !== 'CONNECT' && plan.currency === 'USD') return this.unlimitedResult(input);
    const quota = await tx.planVersionQuota.findUnique({ where: { planVersionId_quotaCode: { planVersionId: plan.id, quotaCode: input.quotaCode } } });
    if (!quota) throw new ConflictException('Quota is not included in the active plan');
    const periodKey = this.periodKey(quota.mode, plan.billingPeriod, at);
    const limit = await this.effectiveLimit(tx, input.organizationId, input.quotaCode, quota.limitValue, at);
    const existing = await tx.quotaReservation.findUnique({ where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey } } });
    if (existing) {
      if (existing.quotaCode !== input.quotaCode || existing.periodKey !== periodKey || existing.amount !== input.amount) throw new ConflictException('Quota idempotency key was already used with different parameters');
      return this.result(existing);
    }
    const usageId = randomUUID();
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "organization_quota_usages" ("id", "organization_id", "quota_code", "period_key", "limit_value")
      VALUES (${usageId}::uuid, ${input.organizationId}::uuid, ${input.quotaCode}, ${periodKey}, ${limit})
      ON CONFLICT ("organization_id", "quota_code", "period_key") DO NOTHING
    `);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "organization_quota_usages" SET "limit_value" = ${limit}, "updated_at" = CURRENT_TIMESTAMP
      WHERE "organization_id" = ${input.organizationId}::uuid AND "quota_code" = ${input.quotaCode} AND "period_key" = ${periodKey}
    `);
    const changed = await tx.$executeRaw(Prisma.sql`
      UPDATE "organization_quota_usages"
      SET "used_value" = "used_value" + ${input.amount}, "updated_at" = CURRENT_TIMESTAMP
      WHERE "organization_id" = ${input.organizationId}::uuid AND "quota_code" = ${input.quotaCode} AND "period_key" = ${periodKey}
        AND "used_value" + "reserved_value" + ${input.amount} <= "limit_value"
    `);
    if (changed !== 1) throw new ConflictException('Quota capacity exceeded');
    const reservation = await tx.quotaReservation.create({ data: { id: randomUUID(), organizationId: input.organizationId, quotaCode: input.quotaCode, periodKey, amount: input.amount, limitValue: limit, status: 'COMMITTED', idempotencyKey: input.idempotencyKey } });
    const context = currentEventContext() ?? createRequestContext();
    await this.recordMutation(tx, 'QUOTA_COMMITTED', 'quota.committed', reservation, context, { resourceType: input.resourceType, resourceId: input.resourceId });
    return this.result(reservation);
  }

  async reconcileCapacity(tx: Prisma.TransactionClient, input: ReconcileCapacityInput): Promise<QuotaReservationResult> {
    if (input.direction === 'INCREASE') return this.consume(tx, input);
    this.assertInput(input);
    if (!input.resourceType.trim() || !input.resourceId.trim()) throw new BadRequestException('Quota resource is invalid');
    const at = input.at ?? new Date();
    const subscription = await tx.subscription.findFirst({ where: { organizationId: input.organizationId, organization: { status: 'ACTIVE' }, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] }, startsAt: { lte: at }, OR: [{ endsAt: null }, { endsAt: { gt: at } }] }, orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }], select: { planVersion: { select: { id: true, planCode: true, currency: true, billingPeriod: true } } } });
    if (!subscription) throw new ConflictException('Organization has no active subscription');
    const plan = subscription.planVersion;
    if (input.quotaCode === 'MAX_USERS' && plan.planCode !== 'CONNECT' && plan.currency === 'USD') return this.unlimitedResult(input);
    const quota = await tx.planVersionQuota.findUnique({ where: { planVersionId_quotaCode: { planVersionId: plan.id, quotaCode: input.quotaCode } } });
    if (!quota || quota.mode !== 'CAPACITY') throw new ConflictException('Quota is not a capacity quota');
    const periodKey = this.periodKey(quota.mode, plan.billingPeriod, at);
    const limit = await this.effectiveLimit(tx, input.organizationId, input.quotaCode, quota.limitValue, at);
    const existing = await tx.quotaReservation.findUnique({ where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey } } });
    if (existing) {
      if (existing.quotaCode !== input.quotaCode || existing.periodKey !== periodKey || existing.amount !== input.amount) throw new ConflictException('Quota idempotency key was already used with different parameters');
      return this.result(existing);
    }
    const usageId = randomUUID();
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "organization_quota_usages" ("id", "organization_id", "quota_code", "period_key", "limit_value")
      VALUES (${usageId}::uuid, ${input.organizationId}::uuid, ${input.quotaCode}, ${periodKey}, ${limit})
      ON CONFLICT ("organization_id", "quota_code", "period_key") DO NOTHING
    `);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "organization_quota_usages" SET "limit_value" = ${limit}, "updated_at" = CURRENT_TIMESTAMP
      WHERE "organization_id" = ${input.organizationId}::uuid AND "quota_code" = ${input.quotaCode} AND "period_key" = ${periodKey}
    `);
    const changed = await tx.$executeRaw(Prisma.sql`
      UPDATE "organization_quota_usages"
      SET "used_value" = "used_value" - ${input.amount}, "updated_at" = CURRENT_TIMESTAMP
      WHERE "organization_id" = ${input.organizationId}::uuid AND "quota_code" = ${input.quotaCode} AND "period_key" = ${periodKey}
        AND "used_value" >= ${input.amount}
    `);
    if (changed !== 1) throw new ConflictException('Quota capacity state is inconsistent');
    const reservation = await tx.quotaReservation.create({ data: { id: randomUUID(), organizationId: input.organizationId, quotaCode: input.quotaCode, periodKey, amount: input.amount, limitValue: limit, status: 'RELEASED', idempotencyKey: input.idempotencyKey } });
    const context = currentEventContext() ?? createRequestContext();
    await this.recordMutation(tx, 'QUOTA_RELEASED', 'quota.released', reservation, context, { resourceType: input.resourceType, resourceId: input.resourceId });
    return this.result(reservation);
  }

  async commit(id: string): Promise<QuotaReservationResult> {
    return this.finish(id, 'COMMITTED');
  }

  async release(id: string): Promise<QuotaReservationResult> {
    return this.finish(id, 'RELEASED');
  }

  async list(organizationId: string, at = new Date()): Promise<Array<{ quotaCode: string; unit: string; mode: QuotaMode; limit: string; used: string; reserved: string; available: string; periodKey: string }>> {
    const subscription = await this.subscriptions.resolveEffective(organizationId, at);
    if (!subscription) return [];
    const plan = await this.prisma.planVersion.findUniqueOrThrow({ where: { id: subscription.planVersionId }, select: { planCode: true, currency: true, billingPeriod: true, quotas: { select: { quotaCode: true, unit: true, mode: true, limitValue: true } } } });
    const quotas = plan.planCode === 'CONNECT' || plan.currency !== 'USD' ? plan.quotas : plan.quotas.filter((quota) => quota.quotaCode !== 'MAX_USERS');
    const periodKeys = [...new Set(quotas.map((quota) => this.periodKey(quota.mode, plan.billingPeriod, at)))];
    const limits = await this.effectiveLimits(this.prisma, organizationId, quotas, at);
    const usages = await this.prisma.organizationQuotaUsage.findMany({ where: { organizationId, periodKey: { in: periodKeys } }, select: { quotaCode: true, periodKey: true, usedValue: true, reservedValue: true } });
    const usageByCode = new Map(usages.map((usage) => [`${usage.quotaCode}:${usage.periodKey}`, usage]));
    return quotas.map((quota) => {
      const periodKey = this.periodKey(quota.mode, plan.billingPeriod, at);
      const usage = usageByCode.get(`${quota.quotaCode}:${periodKey}`);
      const used = usage?.usedValue ?? 0n;
      const reserved = usage?.reservedValue ?? 0n;
      const limit = limits.get(quota.quotaCode) ?? quota.limitValue;
      return { quotaCode: quota.quotaCode, unit: quota.unit, mode: quota.mode, limit: limit.toString(), used: used.toString(), reserved: reserved.toString(), available: (limit - used - reserved).toString(), periodKey };
    });
  }

  private async finish(id: string, nextStatus: 'COMMITTED' | 'RELEASED'): Promise<QuotaReservationResult> {
    const context = currentEventContext() ?? createRequestContext();
    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.quotaReservation.findUnique({ where: { id } });
      if (!reservation) throw new NotFoundException();
      if (reservation.status === nextStatus) return this.result(reservation);
      if (reservation.status !== 'HELD') throw new ConflictException(`Quota reservation is already ${reservation.status.toLowerCase()}`);
      const changed = nextStatus === 'COMMITTED'
        ? await tx.$executeRaw(Prisma.sql`UPDATE "organization_quota_usages" SET "reserved_value" = "reserved_value" - ${reservation.amount}, "used_value" = "used_value" + ${reservation.amount}, "updated_at" = CURRENT_TIMESTAMP WHERE "organization_id" = ${reservation.organizationId}::uuid AND "quota_code" = ${reservation.quotaCode} AND "period_key" = ${reservation.periodKey} AND "reserved_value" >= ${reservation.amount}`)
        : await tx.$executeRaw(Prisma.sql`UPDATE "organization_quota_usages" SET "reserved_value" = "reserved_value" - ${reservation.amount}, "updated_at" = CURRENT_TIMESTAMP WHERE "organization_id" = ${reservation.organizationId}::uuid AND "quota_code" = ${reservation.quotaCode} AND "period_key" = ${reservation.periodKey} AND "reserved_value" >= ${reservation.amount}`);
      if (changed !== 1) throw new ConflictException('Quota reservation state is inconsistent');
      const updated = await tx.quotaReservation.update({ where: { id }, data: { status: nextStatus } });
      const action = nextStatus === 'COMMITTED' ? 'QUOTA_COMMITTED' : 'QUOTA_RELEASED';
      const eventType = nextStatus === 'COMMITTED' ? 'quota.committed' : 'quota.released';
      await this.recordMutation(tx, action, eventType, updated, context, {});
      return this.result(updated);
    });
  }

  private async recordMutation(tx: Prisma.TransactionClient, action: 'QUOTA_RESERVED' | 'QUOTA_COMMITTED' | 'QUOTA_RELEASED', eventType: string, reservation: { id: string; organizationId: string; quotaCode: string; periodKey: string; amount: bigint }, context: EventContext, extra: Record<string, string>): Promise<void> {
    await tx.quotaLedger.create({ data: { id: randomUUID(), organizationId: reservation.organizationId, quotaCode: reservation.quotaCode, periodKey: reservation.periodKey, reservationId: reservation.id, operation: action === 'QUOTA_RESERVED' ? 'RESERVED' : action === 'QUOTA_COMMITTED' ? 'COMMITTED' : 'RELEASED', amount: reservation.amount, metadataJson: extra } });
    await tx.auditEvent.create({ data: { id: randomUUID(), action, organizationId: reservation.organizationId, targetType: 'QuotaReservation', targetId: reservation.id, requestId: context.requestId ?? null, correlationId: context.correlationId, metadataJson: { quotaCode: reservation.quotaCode, periodKey: reservation.periodKey, amount: reservation.amount.toString(), ...extra } } });
    await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'SYSTEM' }, aggregate: { type: 'QuotaReservation', id: reservation.id }, organizationId: reservation.organizationId, correlationId: context.correlationId, ...(context.requestId ? { requestId: context.requestId } : {}), dataClassification: 'CONFIDENTIAL', purpose: 'product-entitlements-quota', payload: { quotaCode: reservation.quotaCode, periodKey: reservation.periodKey, amount: reservation.amount.toString(), ...extra } }));
  }

  private result(reservation: { id: string; organizationId: string; quotaCode: string; periodKey: string; amount: bigint; limitValue: bigint; status: 'HELD' | 'COMMITTED' | 'RELEASED' }): QuotaReservationResult {
    return { id: reservation.id, organizationId: reservation.organizationId, quotaCode: reservation.quotaCode, periodKey: reservation.periodKey, amount: reservation.amount, limit: reservation.limitValue, status: reservation.status };
  }

  private assertInput(input: ReserveQuotaInput): void {
    if (!/^[A-Z][A-Z0-9_]{1,79}$/.test(input.quotaCode)) throw new BadRequestException('Quota code is invalid');
    if (input.amount <= 0n) throw new BadRequestException('Quota amount must be positive');
    if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 200) throw new BadRequestException('Quota idempotency key is invalid');
  }

  private periodKey(mode: QuotaMode, billingPeriod: 'MONTHLY' | 'YEARLY', at: Date): string {
    if (mode === 'CAPACITY') return 'CURRENT';
    return billingPeriod === 'YEARLY' ? `${at.getUTCFullYear()}` : `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private async effectiveLimit(client: PrismaService | Prisma.TransactionClient, organizationId: string, quotaCode: string, baseLimit: bigint, at: Date): Promise<bigint> {
    if (quotaCode === 'MAX_ESTABLISHMENTS') {
      const subscription = await client.subscription.findFirst({ where: { organizationId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] }, startsAt: { lte: at }, OR: [{ endsAt: null }, { endsAt: { gt: at } }] }, orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }], select: { planVersion: { select: { planCode: true, currency: true } } } });
      if (subscription?.planVersion.currency === 'USD') {
        const price = await client.priceVersion.findFirst({ where: { planCode: subscription.planVersion.planCode, billingPeriod: 'MONTHLY', currency: 'USD', status: 'ACTIVE', startsAt: { lte: at }, OR: [{ retiredAt: null }, { retiredAt: { gt: at } }] }, orderBy: [{ version: 'desc' }, { startsAt: 'desc' }], select: { includedEstablishments: true } });
        if (price) return BigInt(price.includedEstablishments);
      }
    }
    const overrides = await client.organizationEntitlement.findMany({ where: { organizationId, moduleCode: this.quotaModuleCode(quotaCode), effect: 'LIMIT_OVERRIDE', startsAt: { lte: at }, OR: [{ endsAt: null }, { endsAt: { gt: at } }] }, orderBy: [{ createdAt: 'desc' }, { startsAt: 'desc' }], select: { limitsJson: true } });
    for (const override of overrides) {
      const value = override.limitsJson && typeof override.limitsJson === 'object' && !Array.isArray(override.limitsJson) ? (override.limitsJson as Record<string, unknown>)[quotaCode] : undefined;
      if ((typeof value === 'string' && /^\d+$/.test(value)) || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) return BigInt(value);
    }
    return baseLimit;
  }

  private async effectiveLimits(client: PrismaService | Prisma.TransactionClient, organizationId: string, quotas: Array<QuotaDefinition>, at: Date): Promise<Map<string, bigint>> {
    const result = new Map<string, bigint>();
    for (const quota of quotas) result.set(quota.quotaCode, await this.effectiveLimit(client, organizationId, quota.quotaCode, quota.limitValue, at));
    return result;
  }

  private quotaModuleCode(quotaCode: string): string {
    if (quotaCode === 'MAX_USERS') return 'MEMBERSHIPS';
    if (quotaCode === 'MAX_ESTABLISHMENTS') return 'ESTABLISHMENTS';
    return quotaCode;
  }

  private unlimitedResult(input: { organizationId: string; quotaCode: string; amount: bigint }): QuotaReservationResult {
    return { id: randomUUID(), organizationId: input.organizationId, quotaCode: input.quotaCode, periodKey: 'CURRENT', amount: input.amount, limit: 9223372036854775807n, status: 'COMMITTED' };
  }
}
