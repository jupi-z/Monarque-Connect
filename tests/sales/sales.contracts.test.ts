import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

type OpenApiOperation = {
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: { content?: Record<string, { schema?: OpenApiSchema }> };
  responses?: Record<string, { $ref?: string; content?: Record<string, { schema?: OpenApiSchema }> }>;
};

type OpenApiParameter = { $ref?: string };

type OpenApiSchema = {
  $ref?: string;
  type?: string;
  pattern?: string;
  properties?: Record<string, OpenApiSchema>;
  allOf?: OpenApiSchema[];
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
  'listQuotes', 'createQuote', 'getQuote', 'updateQuote', 'sendQuote', 'acceptQuote', 'rejectQuote', 'cancelQuote', 'convertQuoteToOrder',
  'listOrders', 'createOrder', 'getOrder', 'updateOrder', 'confirmOrder', 'cancelOrder', 'convertOrderToInvoice',
  'listInvoices', 'getInvoice', 'updateInvoice', 'issueInvoice', 'voidInvoice',
  'listInvoicePayments', 'recordPayment', 'reversePayment',
];

const mutationOperationIds = new Set(expectedOperations.filter((operationId) => !operationId.startsWith('list') && !operationId.startsWith('get')));

async function loadSpec(): Promise<OpenApiDocument> {
  return parse(await readFile(new URL('../../openapi/openapi.yaml', import.meta.url), 'utf8')) as OpenApiDocument;
}

function allOperations(spec: OpenApiDocument): Array<{ path: string; method: string; operation: OpenApiOperation; pathItem: OpenApiPathItem }> {
  return Object.entries(spec.paths).flatMap(([path, pathItem]) =>
    (['get', 'post', 'patch'] as const).flatMap((method) => {
      const operation = pathItem[method];
      return operation ? [{ path, method, operation, pathItem }] : [];
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

describe('Phase 5 Sales OpenAPI contract', () => {
  it('exposes every normative Sales operation with a detailed response schema', async () => {
    const spec = await loadSpec();
    const operations = allOperations(spec);
    const byId = new Map(operations.map(({ operation }) => [operation.operationId, operation]));

    for (const operationId of expectedOperations) {
      const operation = byId.get(operationId);
      expect(operation, `${operationId} must exist`).toBeDefined();
      expect(operation?.responses, `${operationId} must define responses`).toBeDefined();
      const success = operation?.responses?.['200'] ?? operation?.responses?.['201'];
      expect(success?.content?.['application/json']?.schema, `${operationId} must define a JSON response schema`).toBeDefined();
      for (const status of ['400', '403', '409']) {
        const response = operation?.responses?.[status];
        expect(response?.$ref ?? response?.content?.['application/problem+json']?.schema?.$ref, `${operationId} must define Problem Details for ${status}`).toMatch(/Problem|BadRequest|Forbidden|Conflict/);
      }
    }
  });

  it('requires idempotency keys on every Sales mutation and request schemas on writes', async () => {
    const spec = await loadSpec();
    for (const { operation, pathItem } of allOperations(spec)) {
      if (!operation.operationId || !mutationOperationIds.has(operation.operationId)) continue;
      const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])];
      expect(parameters.some((parameter) => parameter.$ref === '#/components/parameters/IdempotencyKey'), `${operation.operationId} must require Idempotency-Key`).toBe(true);
      if (operation.operationId.startsWith('create') || operation.operationId.startsWith('update') || operation.operationId === 'recordPayment') {
        expect(operation.requestBody?.content?.['application/json']?.schema, `${operation.operationId} must define a request schema`).toBeDefined();
      }
    }
  });

  it('represents all API decimals as strings with explicit precision patterns', async () => {
    const spec = await loadSpec();
    const schemas = spec.components.schemas;
    const decimalSchema = requiredSchema(schemas, 'SalesDecimal');
    const quantitySchema = requiredSchema(schemas, 'SalesQuantity');
    expect(decimalSchema.type).toBe('string');
    expect(decimalSchema.pattern).toContain('4');
    expect(quantitySchema.type).toBe('string');
    expect(quantitySchema.pattern).toContain('6');
    for (const schemaName of ['QuoteLine', 'SalesOrderLine', 'InvoiceLine', 'Quote', 'SalesOrder', 'Invoice', 'PaymentRecord']) {
      expect(requiredSchema(schemas, schemaName), `${schemaName} must exist`).toBeDefined();
    }
    for (const schemaName of ['QuoteLine', 'SalesOrderLine', 'InvoiceLine']) {
      expect(requiredSchema(schemas, schemaName).allOf?.[0]?.$ref).toBe('#/components/schemas/SalesDocumentLine');
    }
    const lineSchema = requiredSchema(schemas, 'SalesDocumentLine');
    expect(requiredProperty(lineSchema, 'quantity').$ref).toBe('#/components/schemas/SalesQuantity');
    expect(requiredProperty(lineSchema, 'unitPrice').$ref).toBe('#/components/schemas/SalesDecimal');
    expect(requiredProperty(lineSchema, 'netAmount').$ref).toBe('#/components/schemas/SalesDecimal');
    expect(requiredProperty(lineSchema, 'grossAmount').$ref).toBe('#/components/schemas/SalesDecimal');
  });
});
