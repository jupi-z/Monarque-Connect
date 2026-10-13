import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

type OpenApiSchema = {
  $ref?: string;
  type?: string | string[];
  pattern?: string;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  oneOf?: Array<{ required?: string[] }>;
};
type OpenApiParameter = { $ref?: string };
type OpenApiOperation = {
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: { content?: Record<string, { schema?: OpenApiSchema }> };
  responses?: Record<string, { $ref?: string; content?: Record<string, { schema?: OpenApiSchema }> }>;
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

const expectedOperations = [
  'listSupplierRfqs', 'createSupplierRfq', 'getSupplierRfq', 'updateSupplierRfq', 'sendSupplierRfq', 'closeSupplierRfq', 'cancelSupplierRfq',
  'listPurchaseOrders', 'createPurchaseOrder', 'getPurchaseOrder', 'updatePurchaseOrder', 'sendPurchaseOrder', 'confirmPurchaseOrder', 'cancelPurchaseOrder',
  'listGoodsReceipts', 'createGoodsReceipt', 'getGoodsReceipt', 'correctGoodsReceipt',
];

const mutationOperationIds = new Set(expectedOperations.filter((operationId) => !operationId.startsWith('list') && !operationId.startsWith('get')));

async function loadSpec(): Promise<OpenApiDocument> {
  return parse(await readFile(new URL('../../openapi/openapi.yaml', import.meta.url), 'utf8')) as OpenApiDocument;
}

function allOperations(spec: OpenApiDocument): Array<{ path: string; operation: OpenApiOperation; pathItem: OpenApiPathItem }> {
  return Object.entries(spec.paths).flatMap(([path, pathItem]) =>
    (['get', 'post', 'patch'] as const).flatMap((method) => {
      const operation = pathItem[method];
      return operation ? [{ path, operation, pathItem }] : [];
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

describe('Phase 6 Purchases OpenAPI contract', () => {
  it('exposes every normative Purchases operation with JSON and Problem Details responses', async () => {
    const spec = await loadSpec();
    const byId = new Map(allOperations(spec).map(({ operation }) => [operation.operationId, operation]));

    for (const operationId of expectedOperations) {
      const operation = byId.get(operationId);
      expect(operation, `${operationId} must exist`).toBeDefined();
      const responses = operation?.responses;
      expect(responses, `${operationId} must define responses`).toBeDefined();
      const success = responses?.['200'] ?? responses?.['201'];
      expect(success?.content?.['application/json']?.schema, `${operationId} must define a JSON response schema`).toBeDefined();
      for (const status of ['400', '401', '403', '404', '409']) {
        const response = responses?.[status];
        expect(response?.$ref ?? response?.content?.['application/problem+json']?.schema?.$ref, `${operationId} must define Problem Details for ${status}`).toMatch(/Problem|BadRequest|Unauthorized|Forbidden|NotFound|Conflict/);
      }
    }
  });

  it('requires idempotency keys and request schemas on Purchases mutations', async () => {
    const spec = await loadSpec();
    for (const { operation, pathItem } of allOperations(spec)) {
      if (!operation.operationId || !mutationOperationIds.has(operation.operationId)) continue;
      const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])];
      expect(parameters.some((parameter) => parameter.$ref === '#/components/parameters/IdempotencyKey'), `${operation.operationId} must require Idempotency-Key`).toBe(true);
      if (operation.operationId.startsWith('create') || operation.operationId.startsWith('update')) {
        expect(operation.requestBody?.content?.['application/json']?.schema, `${operation.operationId} must define a request schema`).toBeDefined();
      }
    }
  });

  it('documents exclusive recipient targets and the establishment filter', async () => {
    const document = await loadSpec();
    const recipient = requiredSchema(document.components.schemas, 'CreateSupplierRFQRecipientRequest');
    expect(recipient.oneOf).toEqual(expect.arrayContaining([
      { required: ['localPartyId'] },
      { required: ['networkOrganizationId'] },
    ]));
    const listPath = document.paths['/organizations/{organizationId}/supplier-rfqs'];
    if (!listPath) throw new Error('Supplier RFQ list path is missing');
    const listOperation = listPath.get;
    if (!listOperation) throw new Error('Supplier RFQ list operation is missing');
    expect(listOperation.parameters ?? []).toEqual(expect.arrayContaining([{ $ref: '#/components/parameters/EstablishmentId' }]));
  });

  it('serializes money and quantities as bounded decimal strings and exposes cursor pages', async () => {
    const spec = await loadSpec();
    const schemas = spec.components.schemas;
    expect(requiredSchema(schemas, 'PurchaseDecimal')).toMatchObject({ type: 'string' });
    expect(requiredSchema(schemas, 'PurchaseDecimal').pattern).toContain('4');
    expect(requiredSchema(schemas, 'PurchaseQuantity')).toMatchObject({ type: 'string' });
    expect(requiredSchema(schemas, 'PurchaseQuantity').pattern).toContain('6');
    expect(requiredProperty(requiredSchema(schemas, 'PurchaseDocumentLine'), 'quantity').$ref).toBe('#/components/schemas/PurchaseQuantity');
    expect(requiredProperty(requiredSchema(schemas, 'PurchaseDocumentLine'), 'unitPrice').$ref).toBe('#/components/schemas/PurchaseDecimal');
    expect(requiredSchema(schemas, 'SupplierRFQPage').required).toEqual(expect.arrayContaining(['items', 'nextCursor']));
    expect(requiredSchema(schemas, 'PurchaseOrderPage').required).toEqual(expect.arrayContaining(['items', 'nextCursor']));
    expect(requiredSchema(schemas, 'GoodsReceiptPage').required).toEqual(expect.arrayContaining(['items', 'nextCursor']));
  });

  it('keeps Goods Receipts in Purchases and explicitly excludes Inventory side effects', async () => {
    const spec = await loadSpec();
    const receiptOperation = allOperations(spec).find(({ operation }) => operation.operationId === 'createGoodsReceipt')?.operation;
    expect(receiptOperation).toBeDefined();
    expect(receiptOperation).not.toHaveProperty('tags', expect.arrayContaining(['Inventory']));
    const receipt = requiredSchema(spec.components.schemas, 'GoodsReceipt');
    expect(requiredProperty(receipt, 'status').$ref).toBe('#/components/schemas/GoodsReceiptStatus');
  });
});
