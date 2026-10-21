import type { IntelligenceMetricCode, IntelligenceMetricKind } from './intelligence.constants.js';

export interface MetricDefinition {
  code: IntelligenceMetricCode;
  definitionVersion: number;
  kind: IntelligenceMetricKind;
  sourceModules: readonly string[];
  requiredPermissions: readonly string[];
  dimensions: readonly string[];
}

const definitions = [
  { code: 'SALES_ISSUED', kind: 'ACTIVITY', sourceModules: ['SALES'], requiredPermissions: ['sales:invoices:read'], dimensions: ['establishmentId', 'currencyKey'] },
  { code: 'PAYMENTS_RECORDED', kind: 'ACTIVITY', sourceModules: ['SALES'], requiredPermissions: ['sales:payments:read'], dimensions: ['establishmentId', 'currencyKey'] },
  { code: 'RECEIVABLES_OUTSTANDING', kind: 'CURRENT_STATE', sourceModules: ['SALES'], requiredPermissions: ['sales:invoices:read'], dimensions: ['establishmentId', 'currencyKey'] },
  { code: 'QUOTE_ORDER_CONVERSION', kind: 'ACTIVITY', sourceModules: ['SALES'], requiredPermissions: ['sales:quotes:read', 'sales:orders:read'], dimensions: ['establishmentId'] },
  { code: 'EXPENSES_RECORDED', kind: 'ACTIVITY', sourceModules: ['EXPENSES'], requiredPermissions: ['expenses:read'], dimensions: ['establishmentId', 'currencyKey'] },
  { code: 'CASH_BALANCE', kind: 'CURRENT_STATE', sourceModules: ['CASH'], requiredPermissions: ['cash:read'], dimensions: ['establishmentId', 'cashAccountId', 'currencyKey'] },
  { code: 'INVENTORY_ON_HAND', kind: 'CURRENT_STATE', sourceModules: ['INVENTORY'], requiredPermissions: ['inventory:read'], dimensions: ['establishmentId', 'warehouseId', 'itemId', 'unit'] },
  { code: 'PURCHASE_ORDERS_PENDING', kind: 'ACTIVITY', sourceModules: ['PURCHASES'], requiredPermissions: ['purchases:orders:read'], dimensions: ['establishmentId'] },
  { code: 'PROJECTS_OVERDUE', kind: 'CURRENT_STATE', sourceModules: ['PROJECTS'], requiredPermissions: ['projects:read'], dimensions: ['establishmentId'] },
  { code: 'CRM_PIPELINE', kind: 'CURRENT_STATE', sourceModules: ['CRM'], requiredPermissions: ['crm:read'], dimensions: ['establishmentId', 'currencyKey'] },
  { code: 'NETWORK_INQUIRIES_CONVERTED', kind: 'ACTIVITY', sourceModules: ['NETWORK_INQUIRIES'], requiredPermissions: ['network:inquiries:read'], dimensions: [] },
] as const;

export const METRIC_REGISTRY = definitions.reduce((registry, definition) => {
  registry[definition.code] = { ...definition, definitionVersion: 1 };
  return registry;
}, {} as Record<IntelligenceMetricCode, MetricDefinition>);

export const METRIC_DEFINITIONS: readonly MetricDefinition[] = Object.values(METRIC_REGISTRY);
