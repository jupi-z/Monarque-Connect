import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { ClaimedOutboxEvent, EventDbClient } from '../events/outbox.repository.js';
import type { IntelligenceMetricCode } from './intelligence.constants.js';
import { METRIC_REGISTRY } from './metric-registry.js';
import { IntelligenceProjectionService, type ProjectionPeriod } from './intelligence-projection.service.js';

const EVENT_METRICS: Readonly<Record<string, readonly IntelligenceMetricCode[]>> = {
  'sales.invoice.created': ['SALES_ISSUED', 'RECEIVABLES_OUTSTANDING'],
  'sales.invoice.updated': ['SALES_ISSUED', 'RECEIVABLES_OUTSTANDING'],
  'sales.invoice.status_changed': ['SALES_ISSUED', 'RECEIVABLES_OUTSTANDING'],
  'sales.payment_record.recorded': ['PAYMENTS_RECORDED', 'RECEIVABLES_OUTSTANDING'],
  'sales.payment_record.reversed': ['PAYMENTS_RECORDED', 'RECEIVABLES_OUTSTANDING'],
  'sales.quote.created': ['QUOTE_ORDER_CONVERSION'],
  'sales.quote.updated': ['QUOTE_ORDER_CONVERSION'],
  'sales.quote.status_changed': ['QUOTE_ORDER_CONVERSION'],
  'sales.order.created': ['QUOTE_ORDER_CONVERSION'],
  'sales.order.updated': ['QUOTE_ORDER_CONVERSION'],
  'sales.order.status_changed': ['QUOTE_ORDER_CONVERSION'],
  'expenses.created': ['EXPENSES_RECORDED'],
  'expenses.updated': ['EXPENSES_RECORDED'],
  'expenses.recorded': ['EXPENSES_RECORDED'],
  'expenses.voided': ['EXPENSES_RECORDED'],
  'cash.movement.created': ['CASH_BALANCE'],
  'cash.movement.corrected': ['CASH_BALANCE'],
  'cash.transfer.created': ['CASH_BALANCE'],
  'inventory.movement.created': ['INVENTORY_ON_HAND'],
  'inventory.transfer.created': ['INVENTORY_ON_HAND'],
  'inventory.balance.reconciled.v1': ['INVENTORY_ON_HAND'],
  'inventory.goods_receipt.assigned': ['INVENTORY_ON_HAND'],
  'inventory.goods_receipt.imported': ['INVENTORY_ON_HAND'],
  'purchases.purchase_order.created.v1': ['PURCHASE_ORDERS_PENDING'],
  'purchases.purchase_order.updated.v1': ['PURCHASE_ORDERS_PENDING'],
  'purchases.purchase_order.status_changed.v1': ['PURCHASE_ORDERS_PENDING'],
  'purchases.goods_receipt.confirmed.v1': ['PURCHASE_ORDERS_PENDING'],
  'purchases.goods_receipt.corrected.v1': ['PURCHASE_ORDERS_PENDING'],
  'project.created.v1': ['PROJECTS_OVERDUE'],
  'project.updated.v1': ['PROJECTS_OVERDUE'],
  'project.status_changed.v1': ['PROJECTS_OVERDUE'],
  'crm.opportunity.created': ['CRM_PIPELINE'],
  'crm.opportunity.status_changed': ['CRM_PIPELINE'],
  'network.inquiry.converted': ['NETWORK_INQUIRIES_CONVERTED'],
};

@Injectable()
export class IntelligenceConsumer {
  readonly consumerName = 'intelligence-projection';
  readonly eventTypes = Object.keys(EVENT_METRICS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projection: IntelligenceProjectionService,
  ) {}

  async handle(_client: EventDbClient, event: ClaimedOutboxEvent): Promise<void> {
    const metricCodes = EVENT_METRICS[event.eventType];
    if (!metricCodes) throw new Error(`Unsupported intelligence source event: ${event.eventType}`);
    const period = metricCodes.some((code) => METRIC_REGISTRY[code].kind === 'ACTIVITY')
      ? await this.affectedActivityPeriod(event)
      : undefined;
    await this.projection.consumeEvent(event, metricCodes, period);
  }

  private async affectedActivityPeriod(event: ClaimedOutboxEvent): Promise<ProjectionPeriod> {
    let sourceDate: Date | null = null;
    switch (event.aggregateType) {
      case 'Invoice':
        {
          const invoice = await this.prisma.invoice.findFirst({ where: { id: event.aggregateId, organizationId: event.organizationId! }, select: { issuedAt: true, createdAt: true } });
          sourceDate = invoice?.issuedAt ?? invoice?.createdAt ?? null;
        }
        break;
      case 'PaymentRecord':
        sourceDate = (await this.prisma.paymentRecord.findFirst({ where: { id: event.aggregateId, organizationId: event.organizationId! }, select: { recordedAt: true } }))?.recordedAt ?? null;
        break;
      case 'Quote':
        sourceDate = (await this.prisma.quote.findFirst({ where: { id: event.aggregateId, organizationId: event.organizationId! }, select: { createdAt: true } }))?.createdAt ?? null;
        break;
      case 'SalesOrder': {
        const order = await this.prisma.salesOrder.findFirst({ where: { id: event.aggregateId, organizationId: event.organizationId! }, select: { createdAt: true, sourceQuote: { select: { createdAt: true } } } });
        sourceDate = order?.sourceQuote?.createdAt ?? order?.createdAt ?? null;
        break;
      }
      case 'Expense':
        sourceDate = (await this.prisma.expense.findFirst({ where: { id: event.aggregateId, organizationId: event.organizationId! }, select: { expenseDate: true } }))?.expenseDate ?? null;
        break;
      case 'NetworkInquiry':
        sourceDate = (await this.prisma.networkInquiry.findFirst({ where: { id: event.aggregateId }, select: { createdAt: true } }))?.createdAt ?? null;
        break;
    }
    sourceDate ??= event.occurredAt;
    const from = new Date(Date.UTC(sourceDate.getUTCFullYear(), sourceDate.getUTCMonth(), sourceDate.getUTCDate()));
    return { from, to: new Date(from.getTime() + 86_400_000) };
  }
}
