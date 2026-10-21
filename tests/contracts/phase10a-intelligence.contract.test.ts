import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

type Schema = {
  $ref?: string;
  type?: string | string[];
  enum?: string[];
  format?: string;
  maximum?: number;
  minimum?: number;
  pattern?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
};
type Parameter = { $ref?: string; name?: string; in?: string; required?: boolean; schema?: Schema };
type Operation = {
  operationId?: string;
  deprecated?: boolean;
  parameters?: Parameter[];
  responses?: Record<string, { $ref?: string; content?: Record<string, { schema?: Schema }> }>;
};
type Document = {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema>; parameters: Record<string, Parameter> };
};

const base = '/organizations/{organizationId}/intelligence';
const expected: Record<string, string> = {
  [`GET ${base}/dashboard`]: 'getIntelligenceDashboard',
  [`GET ${base}/metrics`]: 'listIntelligenceMetrics',
  [`GET ${base}/alerts`]: 'listIntelligenceAlerts',
  [`GET ${base}/alerts/{alertId}`]: 'getIntelligenceAlert',
};

let specificationPromise: Promise<Document> | undefined;

function load(): Promise<Document> {
  specificationPromise ??= readFile(new URL('../../openapi/openapi.yaml', import.meta.url), 'utf8')
    .then((source) => parse(source) as Document);
  return specificationPromise;
}

function getOperation(spec: Document, key: string): Operation {
  const [method, ...parts] = key.split(' ');
  const operation = spec.paths[parts.join(' ')]?.[method?.toLowerCase() ?? ''];
  if (!operation) throw new Error(`Missing operation ${key}`);
  return operation;
}

function schemaByName(spec: Document, name: string): Schema {
  const schema = spec.components.schemas[name];
  if (!schema) throw new Error(`Missing schema ${name}`);
  return schema;
}

function resolveParameter(spec: Document, parameter: Parameter): Parameter {
  if (!parameter.$ref) return parameter;
  const name = parameter.$ref.split('/').at(-1);
  const resolved = name ? spec.components.parameters[name] : undefined;
  if (!resolved) throw new Error(`Missing parameter ${parameter.$ref}`);
  return resolved;
}

describe('Phase 10A Intelligence OpenAPI contract', () => {
  it('exposes the four read-only operations at the normative paths', async () => {
    const spec = await load();
    for (const [key, operationId] of Object.entries(expected)) {
      expect(getOperation(spec, key).operationId, key).toBe(operationId);
    }
  });

  it('documents bounded, UTC activity windows and cursor page sizes', async () => {
    const spec = await load();
    const parameters = (getOperation(spec, `GET ${base}/metrics`).parameters ?? []).map((parameter) => resolveParameter(spec, parameter));
    const byName = new Map(parameters.map((parameter) => [parameter.name, parameter]));
    expect(byName.get('from')?.schema).toMatchObject({ type: 'string', format: 'date-time', pattern: 'Z$' });
    expect(byName.get('to')?.schema).toMatchObject({ type: 'string', format: 'date-time', pattern: 'Z$' });
    expect(byName.get('limit')?.schema).toMatchObject({ type: 'integer', minimum: 1, maximum: 100 });
    expect(byName.get('cursor')?.schema).toMatchObject({ type: 'string', minLength: 1 });
    expect(byName.get('metricCodes')?.schema?.items?.enum).toEqual([
      'SALES_ISSUED', 'PAYMENTS_RECORDED', 'RECEIVABLES_OUTSTANDING', 'QUOTE_ORDER_CONVERSION',
      'EXPENSES_RECORDED', 'CASH_BALANCE', 'INVENTORY_ON_HAND', 'PURCHASE_ORDERS_PENDING',
      'PROJECTS_OVERDUE', 'CRM_PIPELINE', 'NETWORK_INQUIRIES_CONVERTED',
    ]);
  });

  it('requires the nullable next cursor in both paginated response schemas', async () => {
    const spec = await load();
    for (const name of ['IntelligenceMetricPage', 'IntelligenceAlertPage']) {
      const schema = schemaByName(spec, name);
      expect(schema.required).toContain('nextCursor');
      expect(schema.properties?.nextCursor?.type).toEqual(['string', 'null']);
    }
  });

  it('uses exact decimal strings and distinguishes activity from current state', async () => {
    const spec = await load();
    expect(schemaByName(spec, 'IntelligenceDecimal')).toMatchObject({ type: 'string', pattern: '^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$' });
    expect(schemaByName(spec, 'IntelligenceMetricKind').enum).toEqual(['ACTIVITY', 'CURRENT_STATE']);
    expect(schemaByName(spec, 'IntelligenceMetricValue').required).toEqual(
      expect.arrayContaining(['metricCode', 'definitionVersion', 'kind', 'calculatedAt', 'sourceAsOf', 'value']),
    );
    expect(schemaByName(spec, 'IntelligenceMetricPayload').properties?.amount?.$ref).toBe('#/components/schemas/IntelligenceDecimal');
    expect(schemaByName(spec, 'IntelligenceMetricPayload').properties?.ratio?.$ref).toBe('#/components/schemas/IntelligenceDecimal');
    expect(schemaByName(spec, 'IntelligenceMetricPayload').properties?.quantity?.$ref).toBe('#/components/schemas/IntelligenceDecimal');
  });

  it('documents standard authorization, validation and visibility errors', async () => {
    const spec = await load();
    for (const key of Object.keys(expected)) {
      const responses = getOperation(spec, key).responses;
      for (const status of ['400', '401', '403', '404']) {
        expect(responses?.[status]?.$ref, `${key} ${status}`).toBeDefined();
      }
    }
  });

  it('does not advertise Not Implemented for dashboard and metric read operations', async () => {
    const spec = await load();
    expect(getOperation(spec, `GET ${base}/dashboard`).responses).not.toHaveProperty('501');
    expect(getOperation(spec, `GET ${base}/metrics`).responses).not.toHaveProperty('501');
  });

  it('does not advertise Not Implemented for alert list or detail operations', async () => {
    const spec = await load();
    expect(getOperation(spec, `GET ${base}/alerts`).responses).not.toHaveProperty('501');
    expect(getOperation(spec, `GET ${base}/alerts/{alertId}`).responses).not.toHaveProperty('501');
  });

  it('marks the legacy Insights paths as deprecated instead of presenting a second contract', async () => {
    const spec = await load();
    expect(spec.paths['/organizations/{organizationId}/insights/overview']?.get?.deprecated).toBe(true);
    expect(spec.paths['/organizations/{organizationId}/insights/alerts']?.get?.deprecated).toBe(true);
  });
});
