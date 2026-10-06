import fs from 'node:fs/promises';
import { parse } from 'yaml';

const source = await fs.readFile(new URL('../openapi/openapi.yaml', import.meta.url), 'utf8');
const spec = parse(source);

if (!spec || typeof spec !== 'object') throw new Error('OpenAPI document must be an object');
if (spec.openapi !== '3.1.0') throw new Error(`Expected OpenAPI 3.1.0, got ${spec.openapi ?? 'missing'}`);
if (!spec.info?.title || !spec.info?.version) throw new Error('OpenAPI info.title and info.version are required');
if (!spec.paths || typeof spec.paths !== 'object') throw new Error('OpenAPI paths are required');

const operationIds = new Set();
for (const [path, item] of Object.entries(spec.paths)) {
  if (!path.startsWith('/')) throw new Error(`Invalid path key: ${path}`);
  if (!item || typeof item !== 'object') continue;
  for (const method of ['get','post','put','patch','delete']) {
    const operation = item[method];
    if (!operation) continue;
    if (!operation.operationId) throw new Error(`${method.toUpperCase()} ${path} is missing operationId`);
    if (operationIds.has(operation.operationId)) throw new Error(`Duplicate operationId: ${operation.operationId}`);
    operationIds.add(operation.operationId);
  }
}

console.log(`OpenAPI valid: ${operationIds.size} operations`);
