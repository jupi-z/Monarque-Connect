import fs from 'node:fs/promises';

const files = [
  new URL('../contracts/domain-event.schema.json', import.meta.url),
  new URL('../contracts/agent-action-proposal.schema.json', import.meta.url),
];

for (const file of files) {
  const source = await fs.readFile(file, 'utf8');
  const schema = JSON.parse(source);

  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    throw new Error(`${file.pathname}: expected JSON Schema draft 2020-12`);
  }

  if (schema.type !== 'object') {
    throw new Error(`${file.pathname}: top-level schema must be object`);
  }

  if (!Array.isArray(schema.required) || schema.required.length === 0) {
    throw new Error(`${file.pathname}: required fields must be declared`);
  }

  if (!schema.properties || typeof schema.properties !== 'object') {
    throw new Error(`${file.pathname}: properties are required`);
  }

  for (const key of schema.required) {
    if (!(key in schema.properties)) {
      throw new Error(`${file.pathname}: required property "${key}" has no schema`);
    }
  }

  console.log(`Contract schema valid: ${file.pathname}`);
}
