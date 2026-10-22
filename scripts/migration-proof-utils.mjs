export function assertMigrationSet(actualNames, expectedNames, context) {
  const actual = [...actualNames].sort();
  const expected = [...expectedNames].sort();
  const missing = expected.filter((name, index) => name !== actual[index]);
  const unexpected = actual.filter((name, index) => name !== expected[index]);

  if (actual.length !== expected.length || missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${context} migration set mismatch: expected ${expected.length} names, found ${actual.length}; ` +
      `missing=[${missing.join(', ')}], unexpected=[${unexpected.join(', ')}]`,
    );
  }
}
