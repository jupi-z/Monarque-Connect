import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

type Schema = {
  type?: string;
  required?: string[];
  properties?: Record<string, Schema>;
  enum?: string[];
  pattern?: string;
  format?: string;
  minimum?: number;
  $ref?: string;
  items?: Schema;
};

type Operation = {
  operationId?: string;
  parameters?: Array<{ $ref?: string }>;
  requestBody?: { content?: Record<string, { schema?: Schema }> };
  responses?: Record<string, { content?: Record<string, { schema?: Schema }>; $ref?: string }>;
};

type Contract = {
  paths: Record<string, Partial<Record<string, Operation>>>;
  components: { schemas: Record<string, Schema> };
};

async function loadContract(): Promise<Contract> {
  return parse(await readFile(new URL('../../openapi/openapi.yaml', import.meta.url), 'utf8')) as Contract;
}

function operation(contract: Contract, method: string, path: string): Operation {
  const value = contract.paths[path]?.[method.toLowerCase()];
  if (!value || typeof value !== 'object') throw new Error(`Missing ${method} ${path}`);
  return value;
}

function schema(contract: Contract, name: string): Schema {
  const value = contract.components.schemas[name];
  if (!value) throw new Error(`Missing FairScale schema ${name}`);
  return value;
}

describe('FairScale Phase 9.5 OpenAPI contract', () => {
  it('freezes the catalog, quote and capacity operation surface', async () => {
    const contract = await loadContract();
    const expected: Array<[string, string, string]> = [
      ['GET', '/billing/catalog', 'getBillingCatalog'],
      ['POST', '/organizations/{organizationId}/billing/quotes', 'createBillingQuote'],
      ['GET', '/organizations/{organizationId}/billing/quotes/{quoteId}', 'getBillingQuote'],
      ['GET', '/organizations/{organizationId}/billing/capacity', 'getBillingCapacity'],
      ['POST', '/organizations/{organizationId}/billing/capacity/estimate', 'estimateBillingCapacity'],
    ];

    for (const [method, path, operationId] of expected) {
      expect(operation(contract, method, path).operationId, `${method} ${path}`).toBe(operationId);
    }
  });

  it('requires idempotency on quote and capacity mutations', async () => {
    const contract = await loadContract();
    for (const [method, path] of [
      ['POST', '/organizations/{organizationId}/billing/quotes'],
      ['POST', '/organizations/{organizationId}/billing/capacity/estimate'],
    ] as const) {
      const current = operation(contract, method, path);
      expect(current.parameters?.some((parameter) => parameter.$ref === '#/components/parameters/IdempotencyKey')).toBe(true);
      expect(current.requestBody?.content?.['application/json']?.schema).toBeDefined();
      expect(current.responses?.['201']?.content?.['application/json']?.schema ?? current.responses?.['200']?.content?.['application/json']?.schema).toBeDefined();
    }
  });

  it('freezes server-authoritative USD money and FairScale catalog values', async () => {
    const contract = await loadContract();
    expect(schema(contract, 'FairScalePlanCode').enum).toEqual(['CONNECT', 'OPERATIONS', 'BUSINESS', 'ENTERPRISE']);
    expect(schema(contract, 'BillingPeriod').enum).toEqual(['MONTHLY', 'YEARLY']);
    expect(schema(contract, 'BillingMoney').type).toBe('integer');
    expect(schema(contract, 'BillingMoney').minimum).toBe(0);
    expect(schema(contract, 'BillingMoney').format).toBe('int64');
    expect(schema(contract, 'BillingQuote').required).toEqual(expect.arrayContaining(['currency', 'catalogVersion', 'baseAmountMinor', 'discountAmountMinor', 'addonAmountMinor', 'totalAmountMinor', 'lines']));
    expect(schema(contract, 'BillingCapacity').required).toEqual(expect.arrayContaining(['includedEstablishments', 'activeEstablishments', 'addonEstablishments', 'effectiveEstablishments']));
  });
});
