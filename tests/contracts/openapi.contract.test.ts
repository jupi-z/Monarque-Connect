import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

type OpenApiSchema = {
  $ref?: string;
  type?: string | string[];
  enum?: string[];
  pattern?: string;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
};
type OpenApiParameter = { $ref?: string };
type OpenApiResponse = { $ref?: string; content?: Record<string, { schema?: OpenApiSchema }> };
type OpenApiOperation = {
  operationId?: string;
  deprecated?: boolean;
  parameters?: OpenApiParameter[];
  requestBody?: { content?: Record<string, { schema?: OpenApiSchema }> };
  responses?: Record<string, OpenApiResponse>;
};
type OpenApiPathItem = {
  parameters?: OpenApiParameter[];
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  patch?: OpenApiOperation;
};
type OpenApiDocument = {
  paths: Record<string, OpenApiPathItem>;
  components: { schemas: Record<string, OpenApiSchema> };
};

const expectedOperations: Record<string, string> = {
  'GET /organizations/{organizationId}/inventory/balances': 'listInventoryBalances',
  'GET /organizations/{organizationId}/inventory/movements': 'listInventoryMovements',
  'POST /organizations/{organizationId}/inventory/movements': 'createInventoryMovement',
  'POST /organizations/{organizationId}/inventory/transfers': 'createInventoryTransfer',
  'GET /organizations/{organizationId}/inventory/goods-receipts/pending': 'listPendingGoodsReceiptInventory',
  'POST /organizations/{organizationId}/inventory/goods-receipts/{receiptId}/assignment': 'assignGoodsReceiptInventory',
  'POST /organizations/{organizationId}/inventory/goods-receipts/{receiptId}/import': 'importGoodsReceiptInventory',
  'POST /organizations/{organizationId}/inventory/reconciliation': 'reconcileInventory',
  'POST /organizations/{organizationId}/stock-movements': 'createStockMovement',
  'GET /organizations/{organizationId}/expenses': 'listExpenses',
  'POST /organizations/{organizationId}/expenses': 'createExpense',
  'GET /organizations/{organizationId}/expenses/{expenseId}': 'getExpense',
  'PATCH /organizations/{organizationId}/expenses/{expenseId}': 'updateExpense',
  'POST /organizations/{organizationId}/expenses/{expenseId}/record': 'recordExpense',
  'POST /organizations/{organizationId}/expenses/{expenseId}/void': 'voidExpense',
  'GET /organizations/{organizationId}/cash-accounts': 'listCashAccounts',
  'POST /organizations/{organizationId}/cash-accounts': 'createCashAccount',
  'GET /organizations/{organizationId}/cash-accounts/{cashAccountId}': 'getCashAccount',
  'PATCH /organizations/{organizationId}/cash-accounts/{cashAccountId}': 'updateCashAccount',
  'POST /organizations/{organizationId}/cash-accounts/{cashAccountId}/deactivate': 'deactivateCashAccount',
  'POST /organizations/{organizationId}/cash-accounts/{cashAccountId}/reactivate': 'reactivateCashAccount',
  'GET /organizations/{organizationId}/cash-movements': 'listCashMovements',
  'POST /organizations/{organizationId}/cash-movements': 'createCashMovement',
  'POST /organizations/{organizationId}/cash-movements/{movementId}/correct': 'correctCashMovement',
  'POST /organizations/{organizationId}/cash-transfers': 'createCashTransfer',
};

const mutationOperationIds = new Set(
  Object.entries(expectedOperations)
    .filter(([key]) => !key.startsWith('GET '))
    .map(([, operationId]) => operationId),
);

async function loadSpec(): Promise<OpenApiDocument> {
  return parse(await readFile(new URL('../../openapi/openapi.yaml', import.meta.url), 'utf8')) as OpenApiDocument;
}

function allOperations(spec: OpenApiDocument): Array<{ key: string; operation: OpenApiOperation; pathItem: OpenApiPathItem }> {
  return Object.entries(spec.paths).flatMap(([path, pathItem]) =>
    (['get', 'post', 'patch'] as const).flatMap((method) => {
      const operation = pathItem[method];
      return operation ? [{ key: `${method.toUpperCase()} ${path}`, operation, pathItem }] : [];
    }),
  );
}

function requiredSchema(schemas: Record<string, OpenApiSchema>, name: string): OpenApiSchema {
  const schema = schemas[name];
  if (!schema) throw new Error(`Missing schema: ${name}`);
  return schema;
}

function requiredProperty(schema: OpenApiSchema, name: string): OpenApiSchema {
  const property = schema.properties?.[name];
  if (!property) throw new Error(`Missing property ${name}`);
  return property;
}

describe('Phase 7 Operations OpenAPI contract', () => {
  it('exposes every normative operation at its canonical path', async () => {
    const spec = await loadSpec();
    const actual = new Map(allOperations(spec).map(({ key, operation }) => [key, operation.operationId]));

    for (const [key, operationId] of Object.entries(expectedOperations)) {
      expect(actual.get(key), `${key} must expose ${operationId}`).toBe(operationId);
    }
  });

  it('defines JSON success and Problem Details responses for every operation', async () => {
    const spec = await loadSpec();
    for (const { key, operation } of allOperations(spec)) {
      if (!Object.prototype.hasOwnProperty.call(expectedOperations, key)) continue;
      const responses = operation.responses;
      expect(responses, `${key} must define responses`).toBeDefined();
      const success = responses?.['200'] ?? responses?.['201'];
      expect(success?.content?.['application/json']?.schema, `${key} must define a JSON success schema`).toBeDefined();
      for (const status of ['400', '401', '403', '404', '409']) {
        const response = responses?.[status];
        expect(response?.$ref ?? response?.content?.['application/problem+json']?.schema?.$ref, `${key} must define Problem Details for ${status}`).toMatch(/Problem|BadRequest|Unauthorized|Forbidden|NotFound|Conflict/);
      }
    }
  });

  it('requires Idempotency-Key on every Phase 7 mutation and request schemas on writes', async () => {
    const spec = await loadSpec();
    for (const { key, operation, pathItem } of allOperations(spec)) {
      const operationId = expectedOperations[key];
      if (!operationId || !mutationOperationIds.has(operationId)) continue;
      const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])];
      expect(parameters.some((parameter) => parameter.$ref === '#/components/parameters/IdempotencyKey'), `${operationId} must require Idempotency-Key`).toBe(true);
      expect(operation.requestBody?.content?.['application/json']?.schema, `${operationId} must define a request schema`).toBeDefined();
    }
  });

  it('uses bounded decimal strings for quantities, money and derived balances', async () => {
    const spec = await loadSpec();
    const schemas = spec.components.schemas;
    expect(requiredSchema(schemas, 'OperationsDecimal')).toMatchObject({ type: 'string' });
    expect(requiredSchema(schemas, 'OperationsDecimal').pattern).toContain('4');
    expect(requiredSchema(schemas, 'OperationsPositiveDecimal')).toMatchObject({ type: 'string' });
    const positivePattern = requiredSchema(schemas, 'OperationsPositiveDecimal').pattern;
    expect(positivePattern).toBeDefined();
    const positiveDecimal = new RegExp(positivePattern as string);
    for (const value of ['1', '1.0000', '0.1', '0.0001']) expect(positiveDecimal.test(value), `${value} must be accepted`).toBe(true);
    for (const value of ['0', '0.0000', '-1', '1.00000', '1234567890123456', '0001']) expect(positiveDecimal.test(value), `${value} must be rejected`).toBe(false);
    expect(requiredSchema(schemas, 'OperationsQuantity')).toMatchObject({ type: 'string' });
    expect(requiredSchema(schemas, 'OperationsQuantity').pattern).toContain('6');
    expect(requiredProperty(requiredSchema(schemas, 'InventoryMovement'), 'quantityDelta').$ref).toBe('#/components/schemas/OperationsQuantity');
    expect(requiredProperty(requiredSchema(schemas, 'Expense'), 'amount').$ref).toBe('#/components/schemas/OperationsDecimal');
    expect(requiredProperty(requiredSchema(schemas, 'CashMovement'), 'amount').$ref).toBe('#/components/schemas/OperationsPositiveDecimal');
    expect(requiredProperty(requiredSchema(schemas, 'InventoryBalance'), 'quantity').$ref).toBe('#/components/schemas/OperationsQuantity');
  });

  it('makes ledger, lifecycle and integration invariants explicit in schemas', async () => {
    const spec = await loadSpec();
    const schemas = spec.components.schemas;
    expect(requiredSchema(schemas, 'InventoryMovementType').enum).toEqual(expect.arrayContaining(['RECEIPT_IN', 'SALE_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_IN', 'TRANSFER_OUT']));
    expect(requiredSchema(schemas, 'ExpenseStatus').enum).toEqual(['DRAFT', 'RECORDED', 'VOID']);
    expect(requiredSchema(schemas, 'CashAccountStatus').enum).toEqual(['ACTIVE', 'INACTIVE']);
    expect(requiredSchema(schemas, 'CashMovementDirection').enum).toEqual(['IN', 'OUT']);
    expect(requiredSchema(schemas, 'GoodsReceiptInventoryLinkStatus').enum).toEqual(['PENDING_ASSIGNMENT', 'ASSIGNED', 'IMPORTED']);
    expect(requiredProperty(requiredSchema(schemas, 'Expense'), 'status').$ref).toBe('#/components/schemas/ExpenseStatus');
    expect(requiredProperty(requiredSchema(schemas, 'CashAccount'), 'status').$ref).toBe('#/components/schemas/CashAccountStatus');
    expect(requiredProperty(requiredSchema(schemas, 'GoodsReceiptInventoryLink'), 'status').$ref).toBe('#/components/schemas/GoodsReceiptInventoryLinkStatus');
    expect(requiredSchema(schemas, 'ReconcileInventoryRequest').required).toEqual(expect.arrayContaining(['establishmentId', 'warehouseId', 'itemId', 'observedQuantity']));
  });

  it('keeps the old stock movement contract only as an explicit deprecated alias', async () => {
    const spec = await loadSpec();
    const path = spec.paths['/organizations/{organizationId}/stock-movements'];
    expect(path?.post?.deprecated).toBe(true);
    expect(path?.post?.requestBody?.content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/CreateInventoryMovementRequest');
  });
});
