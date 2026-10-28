import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

type Parameter = { $ref?: string; name?: string; in?: string; required?: boolean; schema?: Schema };
type Schema = {
  type?: string | string[];
  format?: string;
  pattern?: string;
  maxLength?: number;
  description?: string;
  enum?: unknown[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  $ref?: string;
  allOf?: Schema[];
  anyOf?: Schema[];
};
type Operation = { operationId?: string; parameters?: Parameter[]; requestBody?: { description?: string; content?: Record<string, { schema?: Schema }> }; responses?: Record<string, { description?: string; content?: Record<string, { schema?: Schema }> }> };
type PathItem = Record<string, Operation> & { parameters?: Parameter[] };
type Document = {
  info: { 'x-contract-status'?: string };
  servers: Array<{ url: string }>;
  paths: Record<string, PathItem>;
  components: { schemas: Record<string, Schema>; parameters: Record<string, Parameter> };
};

const expected: Record<string, string> = {
  'GET /catalog/measure-units': 'listMeasureUnits',
  'GET /catalog/currencies': 'listCurrencies',
  'GET /organizations/{organizationId}/catalog/offers': 'listCommercialOffers',
  'POST /organizations/{organizationId}/catalog/offers': 'createCommercialOffer',
  'PATCH /organizations/{organizationId}/catalog/offers/{offerId}': 'updateCommercialOffer',
  'POST /organizations/{organizationId}/catalog/offers/{offerId}/price-versions': 'publishCommercialPriceVersion',
  'POST /organizations/{organizationId}/catalog/items/{itemId}/variants': 'createItemVariant',
  'POST /organizations/{organizationId}/pricing/policy-versions': 'createPricingPolicyVersion',
  'POST /organizations/{organizationId}/pricing/tax-policy-versions': 'createTaxPolicyVersion',
  'POST /organizations/{organizationId}/pricing/tax-policy-versions/{taxPolicyVersionId}/activate': 'activateTaxPolicyVersion',
  'POST /organizations/{organizationId}/pricing/quotes': 'createPricingQuote',
  'GET /organizations/{organizationId}/pricing/quotes/{quoteId}': 'getPricingQuote',
  'POST /platform/pricing/fx-rates': 'ingestFxRate',
};

async function load(): Promise<Document> {
  return parse(await readFile(new URL('../../contracts/phase10a5-c3-proposed.openapi.yaml', import.meta.url), 'utf8')) as Document;
}

function operation(spec: Document, key: string): Operation {
  const [method, ...pathParts] = key.split(' ');
  if (!method) throw new Error(`Invalid operation key ${key}`);
  const path = pathParts.join(' ');
  const pathItem = spec.paths[path];
  if (!pathItem) throw new Error(`Missing proposed path ${path}`);
  const result = pathItem[method.toLowerCase()];
  if (!result) throw new Error(`Missing proposed operation ${key}`);
  const parameters = [...(pathItem.parameters ?? []), ...(result.parameters ?? [])].map((parameter) => {
    if (!parameter.$ref) return parameter;
    const prefix = '#/components/parameters/';
    if (!parameter.$ref.startsWith(prefix)) throw new Error(`Unsupported parameter reference ${parameter.$ref}`);
    const name = parameter.$ref.slice(prefix.length);
    const resolved = spec.components.parameters[name];
    if (!resolved) throw new Error(`Missing proposed parameter ${name}`);
    return resolved;
  });
  return { ...result, parameters };
}

function requiredSchema(spec: Document, name: string): Schema {
  const schema = spec.components.schemas[name];
  if (!schema) throw new Error(`Missing proposed schema ${name}`);
  return schema;
}

function requiredProperty(schema: Schema, name: string): Schema {
  const property = schema.properties?.[name];
  if (!property) throw new Error(`Missing proposed schema property ${name}`);
  return property;
}

function requiredItems(schema: Schema): Schema {
  if (!schema.items) throw new Error('Missing proposed array items schema');
  return schema.items;
}

function requiredParameter(spec: Document, name: string): Parameter {
  const parameter = spec.components.parameters[name];
  if (!parameter) throw new Error(`Missing proposed parameter ${name}`);
  return parameter;
}

function schemaRef(schema: Schema | undefined): string | undefined {
  if (!schema) return undefined;
  return schema.$ref ?? schema.allOf?.map(schemaRef).find(Boolean) ?? schema.anyOf?.map(schemaRef).find(Boolean);
}

describe('C3 proposed catalog and pricing OpenAPI contract', () => {
  it('remains explicitly proposed and freezes every operation before runtime implementation', async () => {
    const spec = await load();
    expect(spec.info['x-contract-status']).toBe('proposed-not-runtime');
    expect(spec.servers).toEqual([{ url: '/api/v1' }]);
    for (const [key, operationId] of Object.entries(expected)) {
      expect(operation(spec, key).operationId, key).toBe(operationId);
    }
  });

  it('requires idempotency for each command that can mutate pricing or catalog state', async () => {
    const spec = await load();
    for (const [key, operationId] of Object.entries(expected)) {
      if (key.startsWith('GET ')) continue;
      expect(operation(spec, key).parameters?.some((parameter) => parameter.name === 'Idempotency-Key' && parameter.in === 'header' && parameter.required), operationId).toBe(true);
    }
  });

  it('serializes every economic value as decimal text and excludes client valuation timestamps', async () => {
    const spec = await load();
    const quoteRequest = requiredSchema(spec, 'CreatePricingQuote');
    expect(requiredProperty(quoteRequest, 'quantity').$ref).toBe('#/components/schemas/PositiveQuantityString');
    expect(quoteRequest.properties).not.toHaveProperty('asOf');
    for (const name of ['CreateCommercialPriceVersion', 'CreatePricingQuote', 'IngestFxRate']) {
      const source = requiredSchema(spec, name);
      const economicFields = name === 'CreateCommercialPriceVersion' ? ['amount'] : name === 'CreatePricingQuote' ? ['quantity'] : ['rate'];
      const expectedSchema = name === 'CreateCommercialPriceVersion' ? 'PositivePriceAmountString' : name === 'CreatePricingQuote' ? 'PositiveQuantityString' : 'PositiveFxRateString';
      for (const field of economicFields) {
        const prop = requiredProperty(source, field);
        expect(schemaRef(prop), `${name}.${field}`).toBe(`#/components/schemas/${expectedSchema}`);
        expect(prop?.type, `${name}.${field}`).not.toBe('number');
      }
    }
    expect(schemaRef(requiredProperty(requiredSchema(spec, 'PricingQuoteSnapshot'), 'targetTotal'))).toBe('#/components/schemas/NonNegativeAmountString');
    expect(requiredSchema(spec, 'PositivePriceAmountString').maxLength).toBe(25);
    expect(requiredSchema(spec, 'PositiveQuantityString').maxLength).toBe(25);
    expect(requiredSchema(spec, 'PositiveFxRateString').maxLength).toBe(25);
    const positivePricePattern = new RegExp(requiredSchema(spec, 'PositivePriceAmountString').pattern!);
    expect(['0.01', '9999999999999999.12345678'].every((value) => positivePricePattern.test(value))).toBe(true);
    expect(['0', '-1', '10000000000000000', '1.123456789'].some((value) => positivePricePattern.test(value))).toBe(false);
    const positiveQuantityPattern = new RegExp(requiredSchema(spec, 'PositiveQuantityString').pattern!);
    expect(['1', '0.01', '999999999999.123456789012'].every((value) => positiveQuantityPattern.test(value))).toBe(true);
    expect(['0', '0.000', '-1', '1e2', '01.2', '1.1234567890123', '1000000000000'].some((value) => positiveQuantityPattern.test(value))).toBe(false);
    const positiveFxPattern = new RegExp(requiredSchema(spec, 'PositiveFxRateString').pattern!);
    expect(['0.000000000000000001', '999999.123456789012345678'].every((value) => positiveFxPattern.test(value))).toBe(true);
    expect(['0', '-1', '1000000', '1.1234567890123456789'].some((value) => positiveFxPattern.test(value))).toBe(false);
  });

  it('requires explicit product selection and non-authoritative tenant scoping for tenant operations', async () => {
    const spec = await load();
    const productResolvedFromTenantScopedResource = new Set(['updateCommercialOffer', 'publishCommercialPriceVersion']);
    const productCode = requiredParameter(spec, 'ProductCode');
    expect(productCode.schema?.pattern).toBe('^[A-Z][A-Z0-9_]{1,63}$');
    expect(productCode.schema).not.toHaveProperty('enum');
    for (const [key, operationId] of Object.entries(expected)) {
      if (!key.includes('/organizations/')) continue;
      const op = operation(spec, key);
      const params = op.parameters ?? [];
      const bodySchema = Object.values(op.requestBody?.content ?? {})[0]?.schema;
      const bodyName = bodySchema?.$ref?.split('/').at(-1);
      const bodyRequiresProduct = bodyName ? requiredSchema(spec, bodyName).required?.includes('productCode') : bodySchema?.required?.includes('productCode');
      expect(params.some((parameter) => parameter.name === 'productCode' && parameter.required) || bodyRequiresProduct || productResolvedFromTenantScopedResource.has(operationId), operationId).toBe(true);
      const productSchema = bodyName ? requiredSchema(spec, bodyName).properties?.productCode : bodySchema?.properties?.productCode;
      if (productSchema) {
        expect(productSchema.pattern, operationId).toBe('^[A-Z][A-Z0-9_]{1,63}$');
        expect(productSchema).not.toHaveProperty('enum');
      }
      const entitlementOp = op as Operation & { 'x-product-entitlement-required'?: boolean };
      expect(entitlementOp['x-product-entitlement-required'], operationId).toBe(true);
      expect(params.some((parameter) => parameter.name === 'organizationId' && parameter.in === 'path'), operationId).toBe(true);
    }
  });

  it('pins actor categories and centrally granted permissions on protected operations', async () => {
    const spec = await load();
    for (const [key, operationId] of Object.entries(expected)) {
      if (key.startsWith('GET /catalog/')) continue;
      const op = operation(spec, key) as Operation & { 'x-required-principal'?: string; 'x-required-permissions'?: string[] };
      expect(op['x-required-principal'], operationId).toBeTruthy();
      expect(op['x-required-permissions']?.length, operationId).toBeGreaterThan(0);
    }
    const fxIngestion = operation(spec, 'POST /platform/pricing/fx-rates') as Operation & { 'x-required-principal'?: string; 'x-required-platform-capability'?: string };
    expect(fxIngestion['x-required-principal']).toBe('PLATFORM');
    expect(fxIngestion['x-required-platform-capability']).toBe('pricing:fx:ingest');
    const taxAdmin = operation(spec, 'POST /organizations/{organizationId}/pricing/tax-policy-versions/{taxPolicyVersionId}/activate') as Operation & { 'x-required-principal'?: string; 'x-required-roles'?: string[] };
    expect(taxAdmin['x-required-principal']).toBe('STAFF');
    expect(taxAdmin['x-required-roles']).toEqual(expect.arrayContaining(['OWNER', 'ADMIN']));
  });

  it('defines fail-closed errors for quote calculation and never creates a sales ledger operation', async () => {
    const spec = await load();
    const quote = operation(spec, 'POST /organizations/{organizationId}/pricing/quotes');
    expect(quote.responses?.['422']).toBeDefined();
    expect(schemaRef(quote.responses?.['201']?.content?.['application/json']?.schema)).toBe('#/components/schemas/PricingQuoteSnapshot');
    const snapshot = requiredSchema(spec, 'PricingQuoteSnapshot');
    expect(snapshot.required).toEqual(expect.arrayContaining(['inputHash', 'priceVersionId', 'pricingPolicyVersionId', 'subtotal', 'netAmount', 'discountAmount', 'sourceTotal', 'sourceCurrency', 'targetTotal', 'roundingPolicyVersion', 'calculationVersion', 'validity', 'establishmentId', 'channelCode', 'variantId', 'fx']));
    expect(requiredProperty(snapshot, 'establishmentId')).toBeDefined();
    expect(requiredProperty(snapshot, 'channelCode')).toBeDefined();
    expect(requiredItems(requiredProperty(snapshot, 'discounts')).$ref).toBe('#/components/schemas/DiscountLineSnapshot');
    expect(requiredItems(requiredProperty(snapshot, 'taxLines')).$ref).toBe('#/components/schemas/TaxLineSnapshot');
    expect(requiredSchema(spec, 'FxSnapshot').required).toEqual(expect.arrayContaining(['sourceReference', 'validFrom', 'validUntil']));
    expect(requiredProperty(snapshot, 'productCode').pattern).toBe('^[A-Z][A-Z0-9_]{1,63}$');
    expect(requiredProperty(snapshot, 'sourceTotal').anyOf?.[1]?.type).toBe('null');
    expect(requiredProperty(snapshot, 'taxCalculationCurrency').enum).toEqual(['SOURCE', 'TARGET']);
  });

  it('keeps tax configuration tenant-admin controlled and explicitly non-certifying', async () => {
    const spec = await load();
    const activate = operation(spec, 'POST /organizations/{organizationId}/pricing/tax-policy-versions/{taxPolicyVersionId}/activate');
    expect(activate.responses?.['200']?.description).toContain('no legal status is implied');
    expect(requiredProperty(requiredSchema(spec, 'ActivateTaxPolicyVersion'), 'acknowledgement').type).toBe('string');
    expect((activate as Operation & { 'x-required-permissions'?: string[] })['x-required-permissions']).toContain('pricing:tax:manage');
  });
});
