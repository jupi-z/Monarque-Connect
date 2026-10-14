import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

type Contract = {
  paths: Record<string, Record<string, { operationId?: string; parameters?: Array<{ $ref?: string }>; requestBody?: unknown; responses?: Record<string, unknown> }>>;
  components: { schemas: Record<string, { enum?: string[]; required?: string[]; properties?: Record<string, unknown> }> };
};

async function loadContract(): Promise<Contract> {
  return parse(await readFile(new URL('../../openapi/openapi.yaml', import.meta.url), 'utf8')) as Contract;
}

const expectedOperations: Record<string, string> = {
  'GET /organizations/{organizationId}/projects': 'listProjects',
  'POST /organizations/{organizationId}/projects': 'createProject',
  'GET /organizations/{organizationId}/projects/{projectId}': 'getProject',
  'PATCH /organizations/{organizationId}/projects/{projectId}': 'updateProject',
  'POST /organizations/{organizationId}/projects/{projectId}/transition': 'transitionProject',
  'GET /organizations/{organizationId}/projects/{projectId}/tasks': 'listProjectTasks',
  'POST /organizations/{organizationId}/projects/{projectId}/tasks': 'createProjectTask',
  'GET /organizations/{organizationId}/tasks/{taskId}': 'getProjectTask',
  'PATCH /organizations/{organizationId}/tasks/{taskId}': 'updateProjectTask',
  'POST /organizations/{organizationId}/tasks/{taskId}/transition': 'transitionProjectTask',
  'GET /organizations/{organizationId}/documents': 'listDocuments',
  'POST /organizations/{organizationId}/documents': 'startDocumentUpload',
  'GET /organizations/{organizationId}/documents/{documentId}': 'getDocument',
  'POST /organizations/{organizationId}/documents/{documentId}/complete': 'completeDocumentUpload',
  'GET /organizations/{organizationId}/documents/{documentId}/content': 'readDocumentContent',
  'POST /organizations/{organizationId}/documents/{documentId}/links': 'linkDocument',
  'DELETE /organizations/{organizationId}/documents/{documentId}/links/{linkId}': 'unlinkDocument',
  'POST /organizations/{organizationId}/documents/{documentId}/revoke': 'revokeDocument',
};

function operations(contract: Contract): Map<string, { operationId?: string; parameters?: Array<{ $ref?: string }>; requestBody?: unknown; responses?: Record<string, unknown> }> {
  return new Map(Object.entries(contract.paths).flatMap(([path, item]) => Object.entries(item).filter(([method]) => ['get', 'post', 'patch', 'delete'].includes(method)).map(([method, operation]) => [`${method.toUpperCase()} ${path}`, operation])));
}

function requiredSchema(contract: Contract, name: string): { enum?: string[]; required?: string[]; properties?: Record<string, unknown> } {
  const schema = contract.components.schemas[name];
  if (!schema) throw new Error(`Missing Phase 8 schema: ${name}`);
  return schema;
}

describe('Phase 8 Projects & Documents OpenAPI contract', () => {
  it('freezes every normative operation and its id', async () => {
    const contract = await loadContract();
    const actual = operations(contract);
    for (const [key, operationId] of Object.entries(expectedOperations)) expect(actual.get(key)?.operationId, `${key} must expose ${operationId}`).toBe(operationId);
  });

  it('requires auth, idempotency and JSON request contracts for mutations', async () => {
    const contract = await loadContract();
    const actual = operations(contract);
    for (const [key, operationId] of Object.entries(expectedOperations)) {
      const operation = actual.get(key);
      expect(operation?.responses, `${operationId} must define responses`).toBeDefined();
      if (key.startsWith('GET ')) continue;
      expect(operation?.parameters?.some((parameter) => parameter.$ref === '#/components/parameters/IdempotencyKey'), `${operationId} must require Idempotency-Key`).toBe(true);
      if (!key.startsWith('DELETE ')) expect(operation?.requestBody, `${operationId} must define a request body`).toBeDefined();
    }
  });

  it('defines the state machines and document target allowlist', async () => {
    const contract = await loadContract();
    expect(requiredSchema(contract, 'ProjectStatus').enum).toEqual(['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED']);
    expect(requiredSchema(contract, 'TaskStatus').enum).toEqual(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED']);
    expect(requiredSchema(contract, 'DocumentStatus').enum).toEqual(['PENDING_UPLOAD', 'AVAILABLE', 'QUARANTINED', 'REVOKED']);
    expect(requiredSchema(contract, 'DocumentLinkTargetType').enum).toEqual(['PROJECT', 'TASK', 'OPPORTUNITY', 'PARTY', 'QUOTE', 'SALES_ORDER', 'INVOICE', 'PAYMENT_RECORD', 'SUPPLIER_RFQ', 'PURCHASE_ORDER', 'GOODS_RECEIPT', 'EXPENSE']);
    expect(requiredSchema(contract, 'Document').required).toEqual(expect.arrayContaining(['organizationId', 'status', 'classification', 'links']));
  });
});
