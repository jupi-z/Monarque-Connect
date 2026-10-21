import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service.js';
import { METRIC_REGISTRY } from './metric-registry.js';
import type { IntelligenceMetricCode } from './intelligence.constants.js';

export interface MetricCalculationInput {
  organizationId: string;
  establishmentIds?: readonly string[];
  from?: Date;
  to?: Date;
  sourceAsOf: Date;
}

export interface MetricCalculationResult {
  metricCode: IntelligenceMetricCode;
  definitionVersion: number;
  kind: 'ACTIVITY' | 'CURRENT_STATE';
  sourceAsOf: string;
  period?: { from: string; to: string };
  dimensions: Record<string, string>;
  value: Record<string, unknown>;
}

type Dimensions = Record<string, string>;
type Aggregate = { count: number; amount: Prisma.Decimal; missingValueCount: number };
const ZERO = new Prisma.Decimal(0);
const MONEY_SCALE = 4;
const QUANTITY_SCALE = 6;
const RATIO_SCALE = 12;

function utcDayStart(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function periodBounds(input: MetricCalculationInput): { gte: Date; lt: Date } {
  if (!input.from || !input.to || Number.isNaN(input.from.getTime()) || Number.isNaN(input.to.getTime()) || input.from >= input.to) {
    throw new BadRequestException('An activity metric requires a valid half-open from/to period.');
  }
  return { gte: input.from, lt: input.to };
}

function periodWhere(input: MetricCalculationInput, field: string): Record<string, { gte: Date; lt: Date }> {
  return { [field]: periodBounds(input) };
}

function establishmentFilter(ids?: readonly string[]): Record<string, unknown> {
  return ids ? { in: [...ids] } : {};
}

function addAggregate(map: Map<string, Aggregate>, dimensions: Dimensions, amount: Prisma.Decimal, missingValue = false): void {
  const key = JSON.stringify(dimensions, Object.keys(dimensions).sort());
  const aggregate = map.get(key) ?? { count: 0, amount: ZERO, missingValueCount: 0 };
  aggregate.count += 1;
  aggregate.amount = aggregate.amount.plus(amount);
  if (missingValue) aggregate.missingValueCount += 1;
  map.set(key, aggregate);
}

function stableEntries<T>(map: Map<string, T>): Array<[string, T]> {
  return [...map.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}

@Injectable()
export class MetricCalculatorService {
  constructor(private readonly prisma: PrismaService) {}

  async calculate(metricCode: IntelligenceMetricCode, input: MetricCalculationInput): Promise<MetricCalculationResult[]> {
    const definition = METRIC_REGISTRY[metricCode];
    if (!definition) throw new BadRequestException('Unknown metric definition.');
    if (!(input.sourceAsOf instanceof Date) || Number.isNaN(input.sourceAsOf.getTime())) {
      throw new BadRequestException('A valid sourceAsOf measurement time is required.');
    }
    if (definition.kind === 'ACTIVITY') periodBounds(input);

    const results: MetricCalculationResult[] = [];
    const emit = (dimensions: Dimensions, value: Record<string, unknown>): void => {
      const result: MetricCalculationResult = {
        metricCode,
        definitionVersion: definition.definitionVersion,
        kind: definition.kind,
        sourceAsOf: input.sourceAsOf.toISOString(),
        dimensions,
        value,
      };
      if (definition.kind === 'ACTIVITY' && input.from && input.to) {
        result.period = { from: input.from.toISOString(), to: input.to.toISOString() };
      }
      results.push(result);
    };
    const scope = { organizationId: input.organizationId };

    switch (metricCode) {
      case 'SALES_ISSUED': {
        const rows = await this.prisma.invoice.findMany({
          where: {
            ...scope,
            establishmentId: establishmentFilter(input.establishmentIds),
            status: { notIn: ['DRAFT', 'VOID'] },
            ...periodWhere(input, 'issuedAt'),
          },
          select: { establishmentId: true, currency: true, totalGross: true },
        });
        const groups = new Map<string, Aggregate>();
        for (const row of rows) {
          const dimensions = { establishmentId: row.establishmentId, currencyKey: row.currency };
          addAggregate(groups, dimensions, row.totalGross);
        }
        for (const [key, aggregate] of stableEntries(groups)) {
          const dimensions = JSON.parse(key) as Dimensions;
          emit(dimensions, { count: aggregate.count, amount: aggregate.amount.toFixed(MONEY_SCALE), currency: dimensions.currencyKey });
        }
        break;
      }
      case 'PAYMENTS_RECORDED': {
        const rows = await this.prisma.paymentRecord.findMany({
          where: {
            ...scope,
            establishmentId: establishmentFilter(input.establishmentIds),
            ...periodWhere(input, 'recordedAt'),
          },
          select: { establishmentId: true, currency: true, amount: true, reversalOfId: true },
        });
        const groups = new Map<string, Aggregate>();
        for (const row of rows) {
          const dimensions = { establishmentId: row.establishmentId, currencyKey: row.currency };
          const signed = row.reversalOfId === null ? row.amount : row.amount.negated();
          addAggregate(groups, dimensions, signed);
        }
        for (const [key, aggregate] of stableEntries(groups)) {
          const dimensions = JSON.parse(key) as Dimensions;
          emit(dimensions, { count: aggregate.count, amount: aggregate.amount.toFixed(MONEY_SCALE), currency: dimensions.currencyKey });
        }
        break;
      }
      case 'RECEIVABLES_OUTSTANDING': {
        const rows = await this.prisma.invoice.findMany({
          where: { ...scope, establishmentId: establishmentFilter(input.establishmentIds), status: { notIn: ['DRAFT', 'VOID'] } },
          select: {
            establishmentId: true,
            currency: true,
            totalGross: true,
            payments: { where: { recordedAt: { lte: input.sourceAsOf } }, select: { amount: true, reversalOfId: true } },
          },
        });
        const groups = new Map<string, Aggregate>();
        for (const invoice of rows) {
          let paid = ZERO;
          for (const payment of invoice.payments) {
            paid = paid.plus(payment.reversalOfId === null ? payment.amount : payment.amount.negated());
          }
          const dimensions = { establishmentId: invoice.establishmentId, currencyKey: invoice.currency };
          addAggregate(groups, dimensions, invoice.totalGross.minus(paid));
        }
        for (const [key, aggregate] of stableEntries(groups)) {
          const dimensions = JSON.parse(key) as Dimensions;
          emit(dimensions, { amount: aggregate.amount.toFixed(MONEY_SCALE), currency: dimensions.currencyKey });
        }
        break;
      }
      case 'QUOTE_ORDER_CONVERSION': {
        const rows = await this.prisma.quote.findMany({
          where: {
            ...scope,
            establishmentId: establishmentFilter(input.establishmentIds),
            status: { not: 'DRAFT' },
            ...periodWhere(input, 'createdAt'),
          },
          select: { establishmentId: true, sourceOrders: { select: { id: true } } },
        });
        const groups = new Map<string, { numerator: number; denominator: number }>();
        for (const quote of rows) {
          const key = quote.establishmentId;
          const aggregate = groups.get(key) ?? { numerator: 0, denominator: 0 };
          aggregate.denominator += 1;
          if (quote.sourceOrders.length > 0) aggregate.numerator += 1;
          groups.set(key, aggregate);
        }
        for (const [establishmentId, aggregate] of stableEntries(groups)) {
          const ratio = aggregate.denominator === 0
            ? ZERO
            : new Prisma.Decimal(aggregate.numerator).div(aggregate.denominator).toDecimalPlaces(RATIO_SCALE, Prisma.Decimal.ROUND_HALF_UP);
          emit({ establishmentId }, {
            count: aggregate.denominator,
            numerator: aggregate.numerator,
            denominator: aggregate.denominator,
            ratio: ratio.toFixed(RATIO_SCALE),
          });
        }
        break;
      }
      case 'EXPENSES_RECORDED': {
        const rows = await this.prisma.expense.findMany({
          where: {
            ...scope,
            establishmentId: establishmentFilter(input.establishmentIds),
            status: 'RECORDED',
            ...periodWhere(input, 'expenseDate'),
          },
          select: { establishmentId: true, currency: true, amount: true },
        });
        const groups = new Map<string, Aggregate>();
        for (const row of rows) {
          const dimensions = { establishmentId: row.establishmentId, currencyKey: row.currency };
          addAggregate(groups, dimensions, row.amount);
        }
        for (const [key, aggregate] of stableEntries(groups)) {
          const dimensions = JSON.parse(key) as Dimensions;
          emit(dimensions, { count: aggregate.count, amount: aggregate.amount.toFixed(MONEY_SCALE), currency: dimensions.currencyKey });
        }
        break;
      }
      case 'CASH_BALANCE': {
        const rows = await this.prisma.cashMovement.findMany({
          where: {
            ...scope,
            establishmentId: establishmentFilter(input.establishmentIds),
            createdAt: { lte: input.sourceAsOf },
          },
          select: { establishmentId: true, cashAccountId: true, currency: true, direction: true, amount: true },
        });
        const groups = new Map<string, Aggregate>();
        for (const row of rows) {
          const dimensions = { establishmentId: row.establishmentId, cashAccountId: row.cashAccountId, currencyKey: row.currency };
          addAggregate(groups, dimensions, row.direction === 'IN' ? row.amount : row.amount.negated());
        }
        for (const [key, aggregate] of stableEntries(groups)) {
          const dimensions = JSON.parse(key) as Dimensions;
          emit(dimensions, { amount: aggregate.amount.toFixed(MONEY_SCALE), currency: dimensions.currencyKey });
        }
        break;
      }
      case 'INVENTORY_ON_HAND': {
        const rows = await this.prisma.inventoryBalance.findMany({
          where: {
            ...scope,
            ...(input.establishmentIds ? { warehouse: { establishmentId: { in: [...input.establishmentIds] } } } : {}),
          },
          select: { warehouseId: true, itemId: true, quantity: true, warehouse: { select: { establishmentId: true } }, item: { select: { unit: true } } },
        });
        for (const row of rows) {
          const dimensions = { establishmentId: row.warehouse.establishmentId, warehouseId: row.warehouseId, itemId: row.itemId, unit: row.item.unit };
          emit(dimensions, { quantity: row.quantity.toFixed(QUANTITY_SCALE), unit: row.item.unit });
        }
        break;
      }
      case 'PURCHASE_ORDERS_PENDING': {
        const rows = await this.prisma.purchaseOrder.findMany({
          where: {
            ...scope,
            establishmentId: establishmentFilter(input.establishmentIds),
            status: { in: ['SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED'] },
          },
          select: { establishmentId: true },
        });
        const groups = new Map<string, number>();
        for (const row of rows) groups.set(row.establishmentId, (groups.get(row.establishmentId) ?? 0) + 1);
        for (const [establishmentId, count] of stableEntries(groups)) emit({ establishmentId }, { count });
        break;
      }
      case 'PROJECTS_OVERDUE': {
        const rows = await this.prisma.project.findMany({
          where: {
            ...scope,
            establishmentId: establishmentFilter(input.establishmentIds),
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
            dueOn: { lt: utcDayStart(input.sourceAsOf) },
          },
          select: { establishmentId: true },
        });
        const groups = new Map<string, number>();
        for (const row of rows) groups.set(row.establishmentId, (groups.get(row.establishmentId) ?? 0) + 1);
        for (const [establishmentId, count] of stableEntries(groups)) emit({ establishmentId }, { count });
        break;
      }
      case 'CRM_PIPELINE': {
        const rows = await this.prisma.opportunity.findMany({
          where: { ...scope, establishmentId: establishmentFilter(input.establishmentIds), status: 'OPEN', active: true },
          select: { establishmentId: true, currency: true, expectedValue: true },
        });
        const groups = new Map<string, Aggregate>();
        for (const row of rows) {
          const currencyKey = row.currency ?? 'NONE';
          const dimensions = { establishmentId: row.establishmentId, currencyKey };
          const missing = row.currency === null || row.expectedValue === null;
          addAggregate(groups, dimensions, missing ? ZERO : row.expectedValue!, missing);
        }
        for (const [key, aggregate] of stableEntries(groups)) {
          const dimensions = JSON.parse(key) as Dimensions;
          const value: Record<string, unknown> = {
            count: aggregate.count,
            amount: aggregate.amount.toFixed(MONEY_SCALE),
            missingValueCount: aggregate.missingValueCount,
          };
          if (dimensions.currencyKey !== 'NONE') value.currency = dimensions.currencyKey;
          emit(dimensions, value);
        }
        break;
      }
      case 'NETWORK_INQUIRIES_CONVERTED': {
        const rows = await this.prisma.networkInquiry.findMany({
          where: {
            targetOrganizationId: input.organizationId,
            status: 'CONVERTED',
            createdAt: periodBounds(input),
            OR: [{ convertedLead: { isNot: null } }, { convertedOpportunity: { isNot: null } }],
          },
          select: { id: true },
        });
        emit({}, { count: rows.length });
        break;
      }
    }
    return results;
  }
}
