import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

type Parameter = { $ref?: string; name?: string; in?: string; required?: boolean; schema?: { pattern?: string } };
type Operation = { operationId?: string; parameters?: Parameter[]; 'x-required-principal'?: string; 'x-required-roles'?: string[]; 'x-required-permissions'?: string[]; 'x-product-entitlement-required'?: boolean; 'x-establishment-scope-derived-from-resource'?: boolean };
type PathItem = { parameters?: Parameter[]; get?: Operation; post?: Operation; patch?: Operation };
type Schema = { $ref?: string; type?: string; required?: string[]; minProperties?: number; properties?: Record<string, { $ref?: string; type?: string; items?: { type?: string }; pattern?: string }> };
type Document = { paths: Record<string, PathItem>; components: { schemas: Record<string, Schema | undefined> } };

const expected: Array<[string, keyof PathItem, string]> = [
  ['/catalog/measure-units', 'get', 'listMeasureUnits'],
  ['/catalog/currencies', 'get', 'listCurrencies'],
  ['/organizations/{organizationId}/catalog/offers', 'get', 'listCommercialOffers'],
  ['/organizations/{organizationId}/catalog/offers', 'post', 'createCommercialOffer'],
  ['/organizations/{organizationId}/catalog/offers/{offerId}/price-versions', 'post', 'publishCommercialPriceVersion'],
  ['/organizations/{organizationId}/catalog/offers/{offerId}', 'patch', 'updateCommercialOffer'],
  ['/organizations/{organizationId}/catalog/items/{itemId}/variants', 'post', 'createItemVariant'],
];

async function load(): Promise<Document> {
  return parse(await readFile(new URL('../../openapi/openapi.yaml', import.meta.url), 'utf8')) as Document;
}

function schema(document: Document, name: string): Schema {
  const value = document.components.schemas[name];
  if (!value) throw new Error(`Missing OpenAPI schema: ${name}`);
  return value;
}

describe('C3 catalog runtime contracts', () => {
  it('documents the authenticated registries and product-scoped offer/variant routes', async () => {
    const spec = await load();
    for (const [path, method, operationId] of expected) {
      const operation = spec.paths[path]?.[method] as Operation | undefined;
      expect(operation?.operationId, `${method.toUpperCase()} ${path}`).toBe(operationId);
    }
    for (const path of [
      '/organizations/{organizationId}/catalog/offers',
      '/organizations/{organizationId}/catalog/offers/{offerId}',
      '/organizations/{organizationId}/catalog/offers/{offerId}/price-versions',
      '/organizations/{organizationId}/catalog/items/{itemId}/variants',
    ]) {
      const item = spec.paths[path]!;
      for (const operation of [item.get, item.post, item.patch].filter((value): value is Operation => Boolean(value))) {
        expect(operation['x-required-principal']).toBe('STAFF');
        expect(operation['x-product-entitlement-required']).toBe(true);
        expect(operation['x-required-permissions']).toContain(operation.operationId === 'listCommercialOffers' ? 'catalog:read' : operation.operationId === 'publishCommercialPriceVersion' ? 'pricing:price:publish' : 'catalog:write');
        expect([...(item.parameters ?? []), ...(operation.parameters ?? [])]).toContainEqual(expect.objectContaining({ $ref: '#/components/parameters/OrganizationId' }));
        if (operation.operationId !== 'listCommercialOffers') expect([...(item.parameters ?? []), ...(operation.parameters ?? [])]).toContainEqual(expect.objectContaining({ $ref: '#/components/parameters/IdempotencyKey' }));
      }
    }
    const offerListParameters = spec.paths['/organizations/{organizationId}/catalog/offers']?.get?.parameters ?? [];
    const channelParameter = offerListParameters.find((parameter) => parameter.name === 'channelCode');
    expect(channelParameter?.in).toBe('query');
    expect(channelParameter?.schema?.pattern).toBe('^[A-Za-z][A-Za-z0-9_]{0,47}$');
  });

  it('keeps precise measurement factors as strings and tenant-scoped models versioned', async () => {
    const spec = await load();
    expect(schema(spec, 'MeasureUnitRegistry').required).toEqual(['version', 'items']);
    expect(schema(spec, 'MeasureUnit').properties?.numerator).toMatchObject({ type: 'string', pattern: '^[1-9][0-9]{0,17}$' });
    expect(schema(spec, 'MeasureUnit').properties?.denominator?.type).toBe('string');
    expect(schema(spec, 'CommercialOffer').required).toContain('organizationId');
    expect(schema(spec, 'CommercialOffer').required).toContain('productCode');
    expect(schema(spec, 'CommercialOffer').properties?.version?.type).toBe('integer');
    expect(schema(spec, 'CurrencyDefinition').required).toEqual(['code', 'minorUnitDigits', 'registryVersion', 'sourceRevision']);
    expect(schema(spec, 'ItemVariant').required).not.toContain('productCode');
    expect(schema(spec, 'ItemVariant').properties).not.toHaveProperty('productCode');
    expect(schema(spec, 'CreateCommercialOffer').properties?.productCode?.pattern).toBe('^[A-Z][A-Z0-9_]{1,63}$');
    expect(schema(spec, 'UpdateCommercialOffer').minProperties).toBe(2);
    expect(schema(spec, 'CreateCommercialOffer').properties?.sellUnitCode?.pattern).toBe('^[A-Za-z][A-Za-z0-9_]{0,31}$');
  });

  it('publishes prices through a separately permissioned immutable version contract', async () => {
    const spec = await load();
    const route = '/organizations/{organizationId}/catalog/offers/{offerId}/price-versions';
    const operation = spec.paths[route]?.post;
    expect(operation?.['x-required-permissions']).toContain('pricing:price:publish');
    expect(operation?.['x-required-principal']).toBe('STAFF');
    expect(operation?.['x-required-roles']).toEqual(['OWNER', 'ADMIN']);
    expect(operation?.['x-establishment-scope-derived-from-resource']).toBe(true);
    expect(operation?.parameters).toContainEqual(expect.objectContaining({ $ref: '#/components/parameters/IdempotencyKey' }));
    expect(schema(spec, 'CreateCommercialPriceVersion').required).toEqual(['amount', 'currencyCode', 'priceUnitCode']);
    expect(schema(spec, 'CreateCommercialPriceVersion').properties?.amount?.$ref).toBe('#/components/schemas/PositiveCommercialPriceAmount');
    expect(schema(spec, 'PositiveCommercialPriceAmount')).toMatchObject({ type: 'string', pattern: expect.any(String) });
    expect(schema(spec, 'CommercialPriceVersion').required).toContain('effectiveFrom');
  });
});
