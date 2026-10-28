import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

type Parameter = { $ref?: string; name?: string; in?: string; required?: boolean };
type Operation = { operationId?: string; parameters?: Parameter[]; 'x-required-principal'?: string; 'x-required-permissions'?: string[]; 'x-product-entitlement-required'?: boolean };
type PathItem = { parameters?: Parameter[]; get?: Operation; post?: Operation; patch?: Operation };
type Document = { paths: Record<string, PathItem>; components: { schemas: Record<string, { type?: string; required?: string[]; properties?: Record<string, { type?: string; items?: { type?: string }; pattern?: string }> }> } };

const expected: Array<[string, keyof PathItem, string]> = [
  ['/catalog/measure-units', 'get', 'listMeasureUnits'],
  ['/catalog/currencies', 'get', 'listCurrencies'],
  ['/organizations/{organizationId}/catalog/offers', 'get', 'listCommercialOffers'],
  ['/organizations/{organizationId}/catalog/offers', 'post', 'createCommercialOffer'],
  ['/organizations/{organizationId}/catalog/offers/{offerId}', 'patch', 'updateCommercialOffer'],
  ['/organizations/{organizationId}/catalog/items/{itemId}/variants', 'post', 'createItemVariant'],
];

async function load(): Promise<Document> {
  return parse(await readFile(new URL('../../openapi/openapi.yaml', import.meta.url), 'utf8')) as Document;
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
      '/organizations/{organizationId}/catalog/items/{itemId}/variants',
    ]) {
      const item = spec.paths[path]!;
      for (const operation of [item.get, item.post, item.patch].filter((value): value is Operation => Boolean(value))) {
        expect(operation['x-required-principal']).toBe('STAFF');
        expect(operation['x-product-entitlement-required']).toBe(true);
        expect(operation['x-required-permissions']).toContain(operation.operationId?.startsWith('list') ? 'catalog:read' : 'catalog:write');
        expect([...(item.parameters ?? []), ...(operation.parameters ?? [])]).toContainEqual(expect.objectContaining({ $ref: '#/components/parameters/OrganizationId' }));
        if (operation.operationId !== 'listCommercialOffers') expect([...(item.parameters ?? []), ...(operation.parameters ?? [])]).toContainEqual(expect.objectContaining({ $ref: '#/components/parameters/IdempotencyKey' }));
      }
    }
    expect(spec.paths['/organizations/{organizationId}/catalog/offers']?.get?.parameters).toContainEqual(expect.objectContaining({ name: 'channelCode', in: 'query', schema: expect.objectContaining({ pattern: '^[A-Za-z][A-Za-z0-9_]{0,47}$' }) }));
  });

  it('keeps precise measurement factors as strings and tenant-scoped models versioned', async () => {
    const spec = await load();
    expect(spec.components.schemas.MeasureUnitRegistry.required).toEqual(['version', 'items']);
    expect(spec.components.schemas.MeasureUnit.properties?.numerator).toMatchObject({ type: 'string', pattern: '^[1-9][0-9]{0,17}$' });
    expect(spec.components.schemas.MeasureUnit.properties?.denominator?.type).toBe('string');
    expect(spec.components.schemas.CommercialOffer.required).toContain('organizationId');
    expect(spec.components.schemas.CommercialOffer.required).toContain('productCode');
    expect(spec.components.schemas.CommercialOffer.properties?.version?.type).toBe('integer');
    expect(spec.components.schemas.CurrencyDefinition.required).toEqual(['code', 'minorUnitDigits', 'registryVersion', 'sourceRevision']);
    expect(spec.components.schemas.ItemVariant.required).not.toContain('productCode');
    expect(spec.components.schemas.ItemVariant.properties).not.toHaveProperty('productCode');
    expect(spec.components.schemas.CreateCommercialOffer.properties?.productCode?.pattern).toBe('^[A-Z][A-Z0-9_]{1,63}$');
    expect(spec.components.schemas.UpdateCommercialOffer.minProperties).toBe(2);
    expect(spec.components.schemas.CreateCommercialOffer.properties?.sellUnitCode?.pattern).toBe('^[A-Za-z][A-Za-z0-9_]{0,31}$');
  });
});
