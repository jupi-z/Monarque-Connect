import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import type { ClaimedOutboxEvent } from '../events/outbox.repository.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import { METRIC_REGISTRY } from './metric-registry.js';
import type { IntelligenceMetricCode } from './intelligence.constants.js';
import { MetricCalculatorService, type MetricCalculationResult } from './metric-calculator.service.js';

export interface ProjectionPeriod {
  from: Date;
  to: Date;
}

export interface RecomputeProjectionInput {
  organizationId: string;
  establishmentIds?: readonly string[];
  metricCodes?: readonly IntelligenceMetricCode[];
  period?: ProjectionPeriod;
  sourceAsOf: Date;
  causeEventId?: string;
}

export interface RebuildProjectionInput {
  organizationId: string;
  establishmentIds?: readonly string[];
  metricCodes?: readonly IntelligenceMetricCode[];
  from: Date;
  to: Date;
  sourceAsOf: Date;
}

const ACTIVITY_MAX_DAYS = 366;
const ACTIVITY_METRICS = new Set<IntelligenceMetricCode>(
  Object.values(METRIC_REGISTRY).filter((definition) => definition.kind === 'ACTIVITY').map(({ code }) => code),
);
const CURRENT_STATE_METRICS = new Set<IntelligenceMetricCode>(
  Object.values(METRIC_REGISTRY).filter((definition) => definition.kind === 'CURRENT_STATE').map(({ code }) => code),
);
const ZERO = new Prisma.Decimal(0);

function utcDayStart(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function isUtcMidnight(value: Date): boolean {
  return value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0;
}

function activityPeriods(period: ProjectionPeriod | undefined, sourceAsOf: Date): ProjectionPeriod[] {
  const first = period?.from ?? utcDayStart(sourceAsOf);
  const last = period?.to ?? new Date(utcDayStart(sourceAsOf).getTime() + 86_400_000);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime()) || first >= last || !isUtcMidnight(first) || !isUtcMidnight(last)) {
    throw new BadRequestException('Activity projection periods must be increasing UTC-midnight boundaries.');
  }
  const dayCount = (last.getTime() - first.getTime()) / 86_400_000;
  if (!Number.isInteger(dayCount) || dayCount > ACTIVITY_MAX_DAYS) {
    throw new BadRequestException(`Activity projection periods are limited to ${ACTIVITY_MAX_DAYS} UTC days.`);
  }
  return Array.from({ length: dayCount }, (_, index) => {
    const from = new Date(first.getTime() + index * 86_400_000);
    return { from, to: new Date(from.getTime() + 86_400_000) };
  });
}

function normalizeDimension(value: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

function establishedScope(establishmentIds?: readonly string[]): Prisma.MetricSnapshotWhereInput {
  return establishmentIds === undefined ? {} : { establishmentId: { in: [...establishmentIds] } };
}

@Injectable()
export class IntelligenceProjectionService {
  private readonly logger = new Logger(IntelligenceProjectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: MetricCalculatorService,
    private readonly outbox: PrismaOutboxWriter,
  ) {}

  async recompute(input: RecomputeProjectionInput): Promise<void> {
    this.validateInput(input);
    await this.withSerializationRetry(() => this.prisma.$transaction(
      async (tx) => {
        await this.lockOrganization(tx, input.organizationId);
        await this.recomputeInTransaction(tx, input);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 },
    ));
  }

  async consumeEvent(event: ClaimedOutboxEvent, metricCodes: readonly IntelligenceMetricCode[], period?: ProjectionPeriod): Promise<void> {
    if (!event.organizationId) throw new Error('Intelligence source events must be organization-scoped.');
    const input: RecomputeProjectionInput = {
      organizationId: event.organizationId,
      ...(event.establishmentId ? { establishmentIds: [event.establishmentId] } : {}),
      metricCodes,
      ...(period ? { period } : {}),
      sourceAsOf: new Date(),
      causeEventId: event.id,
    };
    this.validateInput(input);
    await this.withSerializationRetry(() => this.prisma.$transaction(async (tx) => {
      await this.lockOrganization(tx, event.organizationId!);
      const receipt = await tx.eventConsumerReceipt.createMany({
        data: [{ id: randomUUID(), consumerName: 'intelligence-projection', eventId: event.id }],
        skipDuplicates: true,
      });
      if (receipt.count === 0) return;
      await this.recomputeInTransaction(tx, input);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 }));
  }

  async rebuild(input: RebuildProjectionInput): Promise<void> {
    await this.recompute({
      organizationId: input.organizationId,
      ...(input.establishmentIds ? { establishmentIds: input.establishmentIds } : {}),
      ...(input.metricCodes ? { metricCodes: input.metricCodes } : {}),
      period: { from: input.from, to: input.to },
      sourceAsOf: input.sourceAsOf,
    });
  }

  private validateInput(input: RecomputeProjectionInput): void {
    if (!input.organizationId || !(input.sourceAsOf instanceof Date) || Number.isNaN(input.sourceAsOf.getTime())) {
      throw new BadRequestException('A tenant and valid sourceAsOf measurement time are required.');
    }
    const codes = input.metricCodes ?? Object.keys(METRIC_REGISTRY) as IntelligenceMetricCode[];
    if (codes.length === 0 || codes.some((code) => !METRIC_REGISTRY[code])) {
      throw new BadRequestException('At least one known metric code is required.');
    }
    if (codes.some((code) => ACTIVITY_METRICS.has(code))) activityPeriods(input.period, input.sourceAsOf);
    if (input.establishmentIds?.some((id) => !id) || new Set(input.establishmentIds ?? []).size !== (input.establishmentIds ?? []).length) {
      throw new BadRequestException('Establishment scope must contain unique identifiers.');
    }
  }

  private async recomputeInTransaction(
    tx: Prisma.TransactionClient,
    input: RecomputeProjectionInput,
  ): Promise<void> {
    const metricCodes = input.metricCodes ?? Object.keys(METRIC_REGISTRY) as IntelligenceMetricCode[];
    const periodList = metricCodes.some((metricCode) => ACTIVITY_METRICS.has(metricCode))
      ? activityPeriods(input.period, input.sourceAsOf)
      : [];
    const calculatedAt = new Date();

    for (const metricCode of metricCodes) {
      const definition = METRIC_REGISTRY[metricCode];
      if (CURRENT_STATE_METRICS.has(metricCode)) {
        const results = await this.calculator.calculate(metricCode, {
          organizationId: input.organizationId,
          ...(input.establishmentIds ? { establishmentIds: input.establishmentIds } : {}),
          sourceAsOf: input.sourceAsOf,
        }, tx);
        await this.replaceCurrentState(tx, input, metricCode, results, calculatedAt);
      } else if (ACTIVITY_METRICS.has(metricCode)) {
        for (const period of periodList) {
          const results = await this.calculator.calculate(metricCode, {
            organizationId: input.organizationId,
            ...(input.establishmentIds ? { establishmentIds: input.establishmentIds } : {}),
            from: period.from,
            to: period.to,
            sourceAsOf: input.sourceAsOf,
          }, tx);
          await this.replaceActivityDay(tx, input, metricCode, period, results, calculatedAt);
        }
      }
      if (!definition) throw new BadRequestException('Unknown metric definition.');
    }

    if (metricCodes.includes('RECEIVABLES_OUTSTANDING') || metricCodes.includes('PROJECTS_OVERDUE')) {
      await this.evaluateAlerts(tx, input.organizationId, input.establishmentIds, input.sourceAsOf);
    }
  }

  private async lockOrganization(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId} || ':intelligence-projection', 0)) IS NULL AS lock_acquired`;
  }

  private async replaceActivityDay(
    tx: Prisma.TransactionClient,
    input: RecomputeProjectionInput,
    metricCode: IntelligenceMetricCode,
    period: ProjectionPeriod,
    results: MetricCalculationResult[],
    calculatedAt: Date,
  ): Promise<void> {
    const where: Prisma.MetricSnapshotWhereInput = {
      organizationId: input.organizationId,
      metricCode,
      definitionVersion: METRIC_REGISTRY[metricCode].definitionVersion,
      periodStart: period.from,
      periodEnd: period.to,
      sourceAsOf: { lte: input.sourceAsOf },
      ...establishedScope(input.establishmentIds),
    };
    const latest = await tx.metricSnapshot.aggregate({
      where: {
        organizationId: input.organizationId,
        metricCode,
        definitionVersion: METRIC_REGISTRY[metricCode].definitionVersion,
        periodStart: period.from,
        periodEnd: period.to,
        ...establishedScope(input.establishmentIds),
      },
      _max: { sourceAsOf: true },
    });
    if (latest._max?.sourceAsOf && latest._max.sourceAsOf > input.sourceAsOf) return;
    await tx.metricSnapshot.deleteMany({ where });
    for (const result of results) await this.insertSnapshot(tx, input, metricCode, result, calculatedAt);
  }

  private async replaceCurrentState(
    tx: Prisma.TransactionClient,
    input: RecomputeProjectionInput,
    metricCode: IntelligenceMetricCode,
    results: MetricCalculationResult[],
    calculatedAt: Date,
  ): Promise<void> {
    const baseWhere: Prisma.MetricSnapshotWhereInput = {
      organizationId: input.organizationId,
      metricCode,
      definitionVersion: METRIC_REGISTRY[metricCode].definitionVersion,
      asOf: { not: null },
      ...establishedScope(input.establishmentIds),
    };
    const latest = await tx.metricSnapshot.aggregate({ where: baseWhere, _max: { sourceAsOf: true } });
    if (latest._max?.sourceAsOf && latest._max.sourceAsOf > input.sourceAsOf) return;
    await tx.metricSnapshot.deleteMany({ where: { ...baseWhere, sourceAsOf: { lte: input.sourceAsOf } } });
    for (const result of results) await this.insertSnapshot(tx, input, metricCode, result, calculatedAt);
  }

  private async insertSnapshot(
    tx: Prisma.TransactionClient,
    input: RecomputeProjectionInput,
    metricCode: IntelligenceMetricCode,
    result: MetricCalculationResult,
    calculatedAt: Date,
  ): Promise<void> {
    const establishmentId = result.dimensions.establishmentId ?? null;
    const currencyKey = result.dimensions.currencyKey ?? 'NONE';
    const dimensionKey = normalizeDimension(result.dimensions);
    const isActivity = result.kind === 'ACTIVITY';
    await tx.metricSnapshot.create({
      data: {
        id: randomUUID(),
        organizationId: input.organizationId,
        establishmentId,
        scopeKey: establishmentId ? `ESTABLISHMENT:${establishmentId}` : 'ORG',
        metricCode,
        definitionVersion: result.definitionVersion,
        periodStart: isActivity ? new Date(result.period!.from) : null,
        periodEnd: isActivity ? new Date(result.period!.to) : null,
        asOf: isActivity ? null : input.sourceAsOf,
        valueDecimal: null,
        valueJson: result.value as Prisma.InputJsonValue,
        currency: currencyKey === 'NONE' ? null : currencyKey,
        currencyKey,
        dimensionKey,
        calculatedAt,
        sourceAsOf: input.sourceAsOf,
      },
    });
  }

  private async evaluateAlerts(
    tx: Prisma.TransactionClient,
    organizationId: string,
    establishmentIds: readonly string[] | undefined,
    sourceAsOf: Date,
  ): Promise<void> {
    const scope = establishmentIds ? { establishmentId: { in: [...establishmentIds] } } : {};
    const today = utcDayStart(sourceAsOf);
    const previousEvaluation = await tx.insightAlert.aggregate({
      where: { organizationId, ...(establishmentIds ? scope : {}), ruleCode: { in: ['INVOICE_OVERDUE', 'PROJECT_OVERDUE'] } },
      _max: { lastEvaluatedAt: true },
    });
    if (previousEvaluation._max?.lastEvaluatedAt && previousEvaluation._max.lastEvaluatedAt > sourceAsOf) return;
    const candidates = new Map<string, {
      ruleCode: 'INVOICE_OVERDUE' | 'PROJECT_OVERDUE';
      sourceType: 'INVOICE' | 'PROJECT';
      sourceId: string;
      establishmentId: string;
      triggeredAt: Date;
    }>();

    const invoices = await tx.invoice.findMany({
      where: {
        organizationId,
        ...scope,
        status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
        dueAt: { lt: today },
      },
      select: { id: true, establishmentId: true, totalGross: true, dueAt: true, payments: { where: { recordedAt: { lte: sourceAsOf } }, select: { amount: true, reversalOfId: true } } },
    });
    for (const invoice of invoices) {
      const paid = invoice.payments.reduce((sum, payment) => sum.plus(payment.reversalOfId ? payment.amount.negated() : payment.amount), ZERO);
      if (invoice.totalGross.minus(paid).lessThanOrEqualTo(0)) continue;
      const dedupeKey = `INVOICE_OVERDUE:${invoice.id}`;
      candidates.set(dedupeKey, { ruleCode: 'INVOICE_OVERDUE', sourceType: 'INVOICE', sourceId: invoice.id, establishmentId: invoice.establishmentId, triggeredAt: sourceAsOf });
    }

    const projects = await tx.project.findMany({
      where: { organizationId, ...scope, status: { notIn: ['COMPLETED', 'CANCELLED'] }, dueOn: { lt: today } },
      select: { id: true, establishmentId: true },
    });
    for (const project of projects) {
      const dedupeKey = `PROJECT_OVERDUE:${project.id}`;
      candidates.set(dedupeKey, { ruleCode: 'PROJECT_OVERDUE', sourceType: 'PROJECT', sourceId: project.id, establishmentId: project.establishmentId, triggeredAt: sourceAsOf });
    }

    const openAlerts = await tx.insightAlert.findMany({
      where: { organizationId, status: 'OPEN', ...(establishmentIds ? scope : {}), ruleCode: { in: ['INVOICE_OVERDUE', 'PROJECT_OVERDUE'] } },
      select: { id: true, dedupeKey: true, ruleCode: true, ruleVersion: true, sourceType: true, sourceId: true, establishmentId: true },
    });
    const openByKey = new Map(openAlerts.map((alert) => [alert.dedupeKey, alert]));

    for (const [dedupeKey, candidate] of candidates) {
      const existing = openByKey.get(dedupeKey);
      if (existing) {
        await tx.insightAlert.update({ where: { id: existing.id }, data: { lastEvaluatedAt: sourceAsOf } });
        continue;
      }
      const alertId = randomUUID();
      await tx.insightAlert.create({
        data: {
          id: alertId,
          organizationId,
          establishmentId: candidate.establishmentId,
          ruleCode: candidate.ruleCode,
          ruleVersion: 1,
          severity: 'WARNING',
          status: 'OPEN',
          sourceType: candidate.sourceType,
          sourceId: candidate.sourceId,
          dedupeKey,
          triggeredAt: candidate.triggeredAt,
          lastEvaluatedAt: sourceAsOf,
          payloadJson: {},
        },
      });
      await this.writeAlertEvent(tx, 'intelligence.alert.opened.v1', organizationId, candidate.establishmentId, alertId, candidate, sourceAsOf);
    }

    for (const alert of openAlerts) {
      if (candidates.has(alert.dedupeKey)) continue;
      const result = await tx.insightAlert.updateMany({
        where: { id: alert.id, organizationId, status: 'OPEN' },
        data: { status: 'RESOLVED', resolvedAt: sourceAsOf, lastEvaluatedAt: sourceAsOf },
      });
      if (result.count !== 1) continue;
      await this.writeAlertEvent(tx, 'intelligence.alert.resolved.v1', organizationId, alert.establishmentId, alert.id, {
        ruleCode: alert.ruleCode,
        sourceType: alert.sourceType,
        sourceId: alert.sourceId,
        establishmentId: alert.establishmentId,
      }, sourceAsOf);
    }
  }

  private async writeAlertEvent(
    tx: Prisma.TransactionClient,
    eventType: 'intelligence.alert.opened.v1' | 'intelligence.alert.resolved.v1',
    organizationId: string,
    establishmentId: string | null,
    alertId: string,
    alert: { ruleCode: string; sourceType: string; sourceId: string; establishmentId: string | null },
    occurredAt: Date,
  ): Promise<void> {
    await this.outbox.enqueue(tx, createDomainEvent({
      eventType,
      eventVersion: 1,
      occurredAt: occurredAt.toISOString(),
      actor: { type: 'SYSTEM' },
      aggregate: { type: 'InsightAlert', id: alertId },
      organizationId,
      ...(establishmentId ? { establishmentId } : {}),
      correlationId: randomUUID(),
      dataClassification: 'CONFIDENTIAL',
      purpose: 'intelligence-alert-transition',
      payload: {
        alertId,
        ruleCode: alert.ruleCode,
        ruleVersion: 1,
        sourceType: alert.sourceType,
        sourceId: alert.sourceId,
        ...(establishmentId ? { establishmentId } : {}),
      },
    }));
  }

  private async withSerializationRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code);
        if (!retryable || attempt >= 3) throw error;
        this.logger.debug(`Retrying a conflicted intelligence projection transaction (attempt ${attempt + 1}).`);
      }
    }
  }
}
