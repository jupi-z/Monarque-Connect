import fs from 'node:fs/promises';

const auditPath = process.argv[2];
if (!auditPath) {
  throw new Error('Usage: node scripts/check-runtime-audit.mjs <npm-audit.json>');
}

const [auditSource, lockSource] = await Promise.all([
  fs.readFile(auditPath, 'utf8'),
  fs.readFile(new URL('../package-lock.json', import.meta.url), 'utf8'),
]);

const audit = JSON.parse(auditSource);
const lock = JSON.parse(lockSource);
const packages = lock.packages ?? {};
const root = packages[''] ?? {};

const packageNamesByPath = new Map();
for (const path of Object.keys(packages)) {
  const marker = 'node_modules/';
  const index = path.lastIndexOf(marker);
  if (index === -1) continue;
  packageNamesByPath.set(path, path.slice(index + marker.length));
}

const packageEntriesByName = new Map();
for (const [path, name] of packageNamesByPath) {
  const list = packageEntriesByName.get(name) ?? [];
  list.push(packages[path]);
  packageEntriesByName.set(name, list);
}

const runtimeReachable = new Set();
const queue = Object.keys(root.dependencies ?? {});

while (queue.length > 0) {
  const name = queue.shift();
  if (!name || runtimeReachable.has(name)) continue;
  runtimeReachable.add(name);

  for (const entry of packageEntriesByName.get(name) ?? []) {
    for (const dependencyName of Object.keys(entry.dependencies ?? {})) {
      if (!runtimeReachable.has(dependencyName)) queue.push(dependencyName);
    }
    for (const optionalName of Object.keys(entry.optionalDependencies ?? {})) {
      if (!runtimeReachable.has(optionalName)) queue.push(optionalName);
    }
  }
}

const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const blocking = [];
const ignored = [];

for (const [name, vulnerability] of Object.entries(audit.vulnerabilities ?? {})) {
  const severity = vulnerability.severity ?? 'info';
  if ((severityRank[severity] ?? 0) < severityRank.high) continue;

  const record = {
    name,
    severity,
    range: vulnerability.range,
    runtimeReachable: runtimeReachable.has(name),
  };

  if (record.runtimeReachable) blocking.push(record);
  else ignored.push(record);
}

for (const item of ignored) {
  console.log(
    `Reviewed non-runtime advisory: ${item.name} (${item.severity}) ${item.range ?? ''}`,
  );
}

if (blocking.length > 0) {
  console.error('High/critical vulnerabilities reachable from production dependencies:');
  for (const item of blocking) {
    console.error(`- ${item.name} (${item.severity}) ${item.range ?? ''}`);
  }
  process.exit(1);
}

console.log(
  `Runtime dependency audit passed: ${runtimeReachable.size} production packages reachable; no high/critical advisory is runtime-reachable.`,
);
