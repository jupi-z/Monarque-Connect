import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../src/database/prisma.service.js';
import { METRIC_REGISTRY } from '../../src/intelligence/metric-registry.js';
import { MetricCalculatorService } from '../../src/intelligence/metric-calculator.service.js';
import type { IntelligenceMetricCode } from '../../src/intelligence/intelligence.constants.js';

const organizationId = '00000000-0000-4000-8000-000000000001';
const establishmentId = '00000000-0000-4000-8000-000000000002';
const otherEstablishmentId = '00000000-0000-4000-8000-000000000003';
const from = new Date('2026-10-01T00:00:00.000Z');
const to = new Date('2026-11-01T00:00:00.000Z');
const sourceAsOf = new Date('2026-10-20T12:00:00.000Z');

type Delegate = { findMany: ReturnType<typeof vi.fn> };
type ModelName = 'invoice' | 'paymentRecord' | 'quote' | 'expense' | 'cashMovement' | 'inventoryBalance' | 'purchaseOrder' | 'project' | 'opportunity' | 'networkInquiry';

function prismaWithRows(model: ModelName, rows: unknown[]): Record<ModelName, Delegate> {
  const models: ModelName[] = ['invoice', 'paymentRecord', 'quote', 'expense', 'cashMovement', 'inventoryBalance', 'purchaseOrder', 'project', 'opportunity', 'networkInquiry'];
  return Object.fromEntries(models.map((name) => [name, { findMany: vi.fn().mockResolvedValue(name === model ? rows : []) }])) as Record<ModelName, Delegate>;
}

const cases: Array<{
  code: IntelligenceMetricCode;
  kind: 'ACTIVITY' | 'CURRENT_STATE';
  sourceModules: string[];
  requiredPermissions: string[];
  model: ModelName;
  rows: unknown[];
  expected: Array<{ dimensions: Record<string, string>; value: Record<string, unknown> }>;
}> = [
  {
    code: 'SALES_ISSUED', kind: 'ACTIVITY', sourceModules: ['SALES'], requiredPermissions: ['sales:invoices:read'], model: 'invoice',
    rows: [
      { establishmentId, currency: 'EUR', totalGross: new Prisma.Decimal('100.2500') },
      { establishmentId, currency: 'EUR', totalGross: new Prisma.Decimal('5.2500') },
    ],
    expected: [{ dimensions: { establishmentId, currencyKey: 'EUR' }, value: { count: 2, amount: '105.5000', currency: 'EUR' } }],
  },
  {
    code: 'PAYMENTS_RECORDED', kind: 'ACTIVITY', sourceModules: ['SALES'], requiredPermissions: ['sales:payments:read'], model: 'paymentRecord',
    rows: [
      { establishmentId, currency: 'EUR', amount: new Prisma.Decimal('100.0000'), reversalOfId: null, status: 'REVERSED' },
      { establishmentId, currency: 'EUR', amount: new Prisma.Decimal('30.0000'), reversalOfId: '00000000-0000-4000-8000-000000000010', status: 'RECORDED' },
    ],
    expected: [{ dimensions: { establishmentId, currencyKey: 'EUR' }, value: { count: 2, amount: '70.0000', currency: 'EUR' } }],
  },
  {
    code: 'RECEIVABLES_OUTSTANDING', kind: 'CURRENT_STATE', sourceModules: ['SALES'], requiredPermissions: ['sales:invoices:read'], model: 'invoice',
    rows: [
      { establishmentId, currency: 'EUR', totalGross: new Prisma.Decimal('100.0000'), payments: [
        { amount: new Prisma.Decimal('70.0000'), reversalOfId: null, recordedAt: new Date('2026-10-10T00:00:00.000Z') },
        { amount: new Prisma.Decimal('20.0000'), reversalOfId: 'payment-root', recordedAt: new Date('2026-10-19T00:00:00.000Z') },
      ] },
      { establishmentId, currency: 'EUR', totalGross: new Prisma.Decimal('50.0000'), payments: [] },
    ],
    expected: [{ dimensions: { establishmentId, currencyKey: 'EUR' }, value: { amount: '100.0000', currency: 'EUR' } }],
  },
  {
    code: 'QUOTE_ORDER_CONVERSION', kind: 'ACTIVITY', sourceModules: ['SALES'], requiredPermissions: ['sales:quotes:read', 'sales:orders:read'], model: 'quote',
    rows: [
      { establishmentId, sourceOrders: [{ id: 'order-1' }] },
      { establishmentId, sourceOrders: [{ id: 'order-2' }] },
      { establishmentId, sourceOrders: [] },
    ],
    expected: [{ dimensions: { establishmentId }, value: { count: 3, numerator: 2, denominator: 3, ratio: '0.666666666667' } }],
  },
  {
    code: 'EXPENSES_RECORDED', kind: 'ACTIVITY', sourceModules: ['EXPENSES'], requiredPermissions: ['expenses:read'], model: 'expense',
    rows: [
      { establishmentId, currency: 'EUR', amount: new Prisma.Decimal('12.2500') },
      { establishmentId, currency: 'EUR', amount: new Prisma.Decimal('10.0000') },
    ],
    expected: [{ dimensions: { establishmentId, currencyKey: 'EUR' }, value: { count: 2, amount: '22.2500', currency: 'EUR' } }],
  },
  {
    code: 'CASH_BALANCE', kind: 'CURRENT_STATE', sourceModules: ['CASH'], requiredPermissions: ['cash:read'], model: 'cashMovement',
    rows: [
      { establishmentId, cashAccountId: 'cash-account-1', currency: 'EUR', direction: 'IN', amount: new Prisma.Decimal('100.0000') },
      { establishmentId, cashAccountId: 'cash-account-1', currency: 'EUR', direction: 'OUT', amount: new Prisma.Decimal('30.0000') },
      { establishmentId, cashAccountId: 'cash-account-1', currency: 'EUR', direction: 'IN', amount: new Prisma.Decimal('5.0000'), sourceType: 'CORRECTION' },
    ],
    expected: [{ dimensions: { establishmentId, cashAccountId: 'cash-account-1', currencyKey: 'EUR' }, value: { amount: '75.0000', currency: 'EUR' } }],
  },
  {
    code: 'INVENTORY_ON_HAND', kind: 'CURRENT_STATE', sourceModules: ['INVENTORY'], requiredPermissions: ['inventory:read'], model: 'inventoryBalance',
    rows: [
      { warehouseId: 'warehouse-1', itemId: 'item-kg', quantity: new Prisma.Decimal('1.250000'), warehouse: { establishmentId }, item: { unit: 'kg' } },
      { warehouseId: 'warehouse-1', itemId: 'item-l', quantity: new Prisma.Decimal('2.500000'), warehouse: { establishmentId }, item: { unit: 'l' } },
    ],
    expected: [
      { dimensions: { establishmentId, warehouseId: 'warehouse-1', itemId: 'item-kg', unit: 'kg' }, value: { quantity: '1.250000', unit: 'kg' } },
      { dimensions: { establishmentId, warehouseId: 'warehouse-1', itemId: 'item-l', unit: 'l' }, value: { quantity: '2.500000', unit: 'l' } },
    ],
  },
  {
    code: 'PURCHASE_ORDERS_PENDING', kind: 'ACTIVITY', sourceModules: ['PURCHASES'], requiredPermissions: ['purchases:orders:read'], model: 'purchaseOrder',
    rows: [{ establishmentId }, { establishmentId }, { establishmentId: otherEstablishmentId }],
    expected: [
      { dimensions: { establishmentId }, value: { count: 2 } },
      { dimensions: { establishmentId: otherEstablishmentId }, value: { count: 1 } },
    ],
  },
  {
    code: 'PROJECTS_OVERDUE', kind: 'CURRENT_STATE', sourceModules: ['PROJECTS'], requiredPermissions: ['projects:read'], model: 'project',
    rows: [{ establishmentId, dueOn: new Date('2026-10-19T00:00:00.000Z'), status: 'ACTIVE' }, { establishmentId, dueOn: new Date('2026-10-18T00:00:00.000Z'), status: 'PLANNED' }],
    expected: [{ dimensions: { establishmentId }, value: { count: 2 } }],
  },
  {
    code: 'CRM_PIPELINE', kind: 'CURRENT_STATE', sourceModules: ['CRM'], requiredPermissions: ['crm:read'], model: 'opportunity',
    rows: [
      { establishmentId, currency: 'EUR', expectedValue: new Prisma.Decimal('100.5000') },
      { establishmentId, currency: 'EUR', expectedValue: null },
      { establishmentId: otherEstablishmentId, currency: 'USD', expectedValue: new Prisma.Decimal('20.0000') },
      { establishmentId, currency: null, expectedValue: new Prisma.Decimal('10.0000') },
    ],
    expected: [
      { dimensions: { establishmentId, currencyKey: 'EUR' }, value: { count: 2, amount: '100.5000', currency: 'EUR', missingValueCount: 1 } },
      { dimensions: { establishmentId, currencyKey: 'NONE' }, value: { count: 1, amount: '0.0000', missingValueCount: 1 } },
      { dimensions: { establishmentId: otherEstablishmentId, currencyKey: 'USD' }, value: { count: 1, amount: '20.0000', currency: 'USD', missingValueCount: 0 } },
    ],
  },
  {
    code: 'NETWORK_INQUIRIES_CONVERTED', kind: 'ACTIVITY', sourceModules: ['NETWORK_INQUIRIES'], requiredPermissions: ['network:inquiries:read'], model: 'networkInquiry',
    rows: [{ id: 'inquiry-1' }, { id: 'inquiry-2' }],
    expected: [{ dimensions: {}, value: { count: 2 } }],
  },
];

describe('versioned metric registry and deterministic calculations', () => {
  it.each(cases)('$code has the normative metadata and computes exact values', async (testCase) => {
    const models = prismaWithRows(testCase.model, testCase.rows);
    const calculator = new MetricCalculatorService(models as unknown as PrismaService);
    const input = {
      organizationId,
      ...(testCase.code !== 'NETWORK_INQUIRIES_CONVERTED' ? { establishmentIds: [establishmentId, otherEstablishmentId] } : {}),
      from,
      to,
      sourceAsOf,
    };

    const definition = METRIC_REGISTRY[testCase.code];
    expect(definition).toMatchObject({ code: testCase.code, definitionVersion: 1, kind: testCase.kind, sourceModules: testCase.sourceModules, requiredPermissions: testCase.requiredPermissions });
    const results = await calculator.calculate(testCase.code, input);
    expect(results.map(({ dimensions, value }) => ({ dimensions, value }))).toEqual(testCase.expected);
    expect(results.every((result) => result.sourceAsOf === sourceAsOf.toISOString())).toBe(true);

    const query = models[testCase.model].findMany.mock.calls[0]?.[0] as { where?: Record<string, unknown> } | undefined;
    if (testCase.code === 'NETWORK_INQUIRIES_CONVERTED') {
      expect(query?.where).toMatchObject({ targetOrganizationId: organizationId, status: 'CONVERTED', createdAt: { gte: from, lt: to } });
    } else {
      expect(query?.where?.organizationId).toBe(organizationId);
    }
    if (input.establishmentIds && testCase.code !== 'NETWORK_INQUIRIES_CONVERTED') {
      expect(JSON.stringify(query?.where)).toContain('establishment');
    }
    switch (testCase.code) {
      case 'SALES_ISSUED':
        expect(query?.where).toMatchObject({ status: { notIn: ['DRAFT', 'VOID'] }, issuedAt: { gte: from, lt: to } });
        break;
      case 'PAYMENTS_RECORDED':
        expect(query?.where).toMatchObject({ recordedAt: { gte: from, lt: to } });
        break;
      case 'RECEIVABLES_OUTSTANDING':
        expect(query?.where).toMatchObject({ status: { notIn: ['DRAFT', 'VOID'] } });
        expect((query as { select?: { payments?: { where?: unknown } } }).select?.payments?.where).toEqual({ recordedAt: { lte: sourceAsOf } });
        break;
      case 'QUOTE_ORDER_CONVERSION':
        expect(query?.where).toMatchObject({ status: { not: 'DRAFT' }, createdAt: { gte: from, lt: to } });
        break;
      case 'EXPENSES_RECORDED':
        expect(query?.where).toMatchObject({ status: 'RECORDED', expenseDate: { gte: from, lt: to } });
        break;
      case 'CASH_BALANCE':
        expect(query?.where).toMatchObject({ createdAt: { lte: sourceAsOf } });
        break;
      case 'PURCHASE_ORDERS_PENDING':
        expect(query?.where).toMatchObject({ status: { in: ['SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED'] } });
        break;
      case 'PROJECTS_OVERDUE':
        expect(query?.where).toMatchObject({ status: { notIn: ['COMPLETED', 'CANCELLED'] }, dueOn: { lt: new Date('2026-10-20T00:00:00.000Z') } });
        break;
      case 'CRM_PIPELINE':
        expect(query?.where).toMatchObject({ status: 'OPEN', active: true });
        break;
    }
  });

  it('requires an explicit valid window for activity metrics', async () => {
    const models = prismaWithRows('invoice', []);
    const calculator = new MetricCalculatorService(models as unknown as PrismaService);
    await expect(calculator.calculate('SALES_ISSUED', { organizationId, sourceAsOf })).rejects.toThrow(/half-open/i);
  });

  it('uses an establishment relation filter for inventory and the recipient tenant for Network inquiries', async () => {
    const inventoryModels = prismaWithRows('inventoryBalance', []);
    const calculator = new MetricCalculatorService(inventoryModels as unknown as PrismaService);
    await calculator.calculate('INVENTORY_ON_HAND', { organizationId, establishmentIds: [establishmentId], sourceAsOf });
    const inventoryQuery = inventoryModels.inventoryBalance.findMany.mock.calls[0]?.[0] as unknown as { where: Record<string, unknown> } | undefined;
    const inventoryWhere = inventoryQuery?.where;
    expect(inventoryWhere).toMatchObject({ organizationId, warehouse: { establishmentId: { in: [establishmentId] } } });

    const inquiryModels = prismaWithRows('networkInquiry', []);
    await new MetricCalculatorService(inquiryModels as unknown as PrismaService).calculate('NETWORK_INQUIRIES_CONVERTED', { organizationId, from, to, sourceAsOf });
    const inquiryQuery = inquiryModels.networkInquiry.findMany.mock.calls[0]?.[0] as unknown as { where: Record<string, unknown> } | undefined;
    expect(inquiryQuery?.where).toMatchObject({ targetOrganizationId: organizationId });
  });
});
