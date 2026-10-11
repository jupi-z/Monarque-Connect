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
  periodKey: string;
  idempotencyKey: string;
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

@Injectable()
export class QuotaService {
  constructor(private readonly prisma: PrismaService, private readonly subscriptions: SubscriptionService, private readonly outbox: PrismaOutboxWriter) {}

  async reserve(input: ReserveQuotaInput): Promise<QuotaReservationResult> {
    this.assertInput(input);
    const existing = await this.prisma.quotaReservation.findUnique({ where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey } } });
    if (existing) {
      if (existing.quotaCode !== input.quotaCode || existing.periodKey !== input.periodKey || existing.amount !== input.amount) throw new ConflictException('Quota idempotency key was already used with different parameters');
      return this.result(existing);
    }
    const subscription = await this.subscriptions.resolveEffective(input.organizationId, this.periodStart(input.periodKey));
    if (!subscription) throw new ConflictException('Organization has no active subscription');
    const quota = await this.prisma.planVersionQuota.findUnique({ where: { planVersionId_quotaCode: { planVersionId: subscription.planVersionId, quotaCode: input.quotaCode } } });
    if (!quota) throw new ConflictException('Quota is not included in the active plan');
    const context = currentEventContext() ?? createRequestContext();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const usageId = randomUUID();
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "organization_quota_usages" ("id", "organization_id", "quota_code", "period_key", "limit_value")
          VALUES (${usageId}::uuid, ${input.organizationId}::uuid, ${input.quotaCode}, ${input.periodKey}, ${quota.limitValue})
          ON CONFLICT ("organization_id", "quota_code", "period_key") DO NOTHING
        `);
        const changed = await tx.$executeRaw(Prisma.sql`
          UPDATE "organization_quota_usages"
          SET "reserved_value" = "reserved_value" + ${input.amount}, "updated_at" = CURRENT_TIMESTAMP
          WHERE "organization_id" = ${input.organizationId}::uuid
            AND "quota_code" = ${input.quotaCode}
            AND "period_key" = ${input.periodKey}
            AND "used_value" + "reserved_value" + ${input.amount} <= "limit_value"
        `);
        if (changed !== 1) throw new ConflictException('Quota capacity exceeded');
        const reservation = await tx.quotaReservation.create({ data: { id: randomUUID(), organizationId: input.organizationId, quotaCode: input.quotaCode, periodKey: input.periodKey, amount: input.amount, limitValue: quota.limitValue, status: 'HELD', idempotencyKey: input.idempotencyKey } });
        await this.recordMutation(tx, 'QUOTA_RESERVED', 'quota.reserved', reservation, context, { amount: input.amount.toString() });
        return this.result(reservation);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.quotaReservation.findUnique({ where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey } } });
        if (existing && existing.quotaCode === input.quotaCode && existing.periodKey === input.periodKey && existing.amount === input.amount) return this.result(existing);
      }
      throw error;
    }
  }

  async commit(id: string): Promise<QuotaReservationResult> {
    return this.finish(id, 'COMMITTED');
  }

  async release(id: string): Promise<QuotaReservationResult> {
    return this.finish(id, 'RELEASED');
  }

  async list(organizationId: string, at = new Date()): Promise<Array<{ quotaCode: string; unit: string; limit: string; used: string; reserved: string; available: string; periodKey: string }>> {
    const subscription = await this.subscriptions.resolveEffective(organizationId, at);
    if (!subscription) return [];
    const plan = await this.prisma.planVersion.findUniqueOrThrow({ where: { id: subscription.planVersionId }, select: { billingPeriod: true, quotas: { select: { quotaCode: true, unit: true, limitValue: true } } } });
    const periodKey = plan.billingPeriod === 'YEARLY' ? `${at.getUTCFullYear()}` : `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
    const usages = await this.prisma.organizationQuotaUsage.findMany({ where: { organizationId, periodKey }, select: { quotaCode: true, usedValue: true, reservedValue: true } });
    const usageByCode = new Map(usages.map((usage) => [usage.quotaCode, usage]));
    return plan.quotas.map((quota) => {
      const usage = usageByCode.get(quota.quotaCode);
      const used = usage?.usedValue ?? 0n;
      const reserved = usage?.reservedValue ?? 0n;
      return { quotaCode: quota.quotaCode, unit: quota.unit, limit: quota.limitValue.toString(), used: used.toString(), reserved: reserved.toString(), available: (quota.limitValue - used - reserved).toString(), periodKey };
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
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(input.periodKey)) throw new BadRequestException('Quota period is invalid');
    if (input.amount <= 0n) throw new BadRequestException('Quota amount must be positive');
    if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 200) throw new BadRequestException('Quota idempotency key is invalid');
  }

  private periodStart(periodKey: string): Date {
    const year = /^(\d{4})$/.exec(periodKey);
    if (year) return new Date(Date.UTC(Number(year[1]), 0, 1));
    const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
    if (!match) return new Date();
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  }
}
