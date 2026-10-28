import fs from 'node:fs/promises';
import { parse } from 'yaml';

const documents = [
  { path: '../openapi/openapi.yaml', proposed: false },
  { path: '../contracts/phase10a5-c3-proposed.openapi.yaml', proposed: true },
];

for (const document of documents) {
  const source = await fs.readFile(new URL(document.path, import.meta.url), 'utf8');
  const spec = parse(source);

  if (!spec || typeof spec !== 'object') throw new Error(`${document.path}: OpenAPI document must be an object`);
  if (spec.openapi !== '3.1.0') throw new Error(`${document.path}: expected OpenAPI 3.1.0, got ${spec.openapi ?? 'missing'}`);
  if (!spec.info?.title || !spec.info?.version) throw new Error(`${document.path}: info.title and info.version are required`);
  if (!spec.paths || typeof spec.paths !== 'object') throw new Error(`${document.path}: paths are required`);
  if (document.proposed && !['proposed-not-runtime', 'partially-implemented'].includes(spec.info['x-contract-status'])) {
    throw new Error('The C3 contract must state whether it is proposed or partially implemented');
  }

  const operationIds = new Set();
  const schemaNames = new Set(Object.keys(spec.components?.schemas ?? {}));
  for (const [path, item] of Object.entries(spec.paths)) {
    if (!path.startsWith('/')) throw new Error(`${document.path}: invalid path key: ${path}`);
    if (!item || typeof item !== 'object') continue;
    for (const method of ['get','post','put','patch','delete']) {
      const operation = item[method];
      if (!operation) continue;
      if (!operation.operationId) throw new Error(`${document.path}: ${method.toUpperCase()} ${path} is missing operationId`);
      if (operationIds.has(operation.operationId)) throw new Error(`${document.path}: duplicate operationId: ${operation.operationId}`);
      operationIds.add(operation.operationId);
    }
  }

  if (document.proposed && spec.info['x-contract-status'] === 'partially-implemented') {
    const implemented = Object.values(spec.paths).flatMap((item) => Object.values(item ?? {}))
      .filter((operation) => operation && typeof operation === 'object' && operation['x-runtime-status'] === 'implemented');
    if (!implemented.length) throw new Error('Partially implemented C3 contract must identify runtime operations');
  }

  const unresolvedSchemaRefs = [...source.matchAll(/#\/components\/schemas\/([A-Za-z0-9_]+)/g)]
    .map((match) => match[1])
    .filter((name) => !schemaNames.has(name));
  if (unresolvedSchemaRefs.length) {
    throw new Error(`${document.path}: unresolved schema refs: ${[...new Set(unresolvedSchemaRefs)].join(', ')}`);
  }

  console.log(`OpenAPI valid: ${operationIds.size} operations (${document.path})`);
}
