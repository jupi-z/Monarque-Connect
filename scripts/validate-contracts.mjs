import fs from 'node:fs/promises';

const schemaFiles = [
  new URL('../contracts/domain-event.schema.json', import.meta.url),
  new URL('../contracts/agent-action-proposal.schema.json', import.meta.url),
];

for (const file of schemaFiles) {
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

const eventSchema = JSON.parse(
  await fs.readFile(new URL('../contracts/domain-event.schema.json', import.meta.url), 'utf8'),
);
const sampleEvent = JSON.parse(
  await fs.readFile(
    new URL('../contracts/examples/organization.created.v1.json', import.meta.url),
    'utf8',
  ),
);

for (const key of eventSchema.required) {
  if (!(key in sampleEvent)) {
    throw new Error(`Sample event is missing required property "${key}"`);
  }
}

if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(sampleEvent.eventType)) {
  throw new Error('Sample eventType does not match the canonical naming convention');
}

if (!['USER', 'SYSTEM', 'AGENT', 'PLATFORM'].includes(sampleEvent.actor?.type)) {
  throw new Error('Sample actor.type is invalid');
}

if (!['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'].includes(sampleEvent.dataClassification)) {
  throw new Error('Sample dataClassification is invalid');
}

console.log('Contract example valid: organization.created.v1.json');
