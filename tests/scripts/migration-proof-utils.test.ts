import { describe, expect, it } from 'vitest';
import { assertMigrationSet } from '../../scripts/migration-proof-utils.mjs';

describe('migration proof set comparison', () => {
  it('accepts the complete applied set independent of completion order', () => {
    expect(() => assertMigrationSet(
      ['20261012120000_quota_modes', '20261011230000_module_activations', '20261012000000_quota_reservations'],
      ['20261011230000_module_activations', '20261012000000_quota_reservations', '20261012120000_quota_modes'],
      'Phase 2 baseline',
    )).not.toThrow();
  });

  it('rejects missing and unexpected migrations even when counts match', () => {
    expect(() => assertMigrationSet(['20261011230000_module_activations', 'unexpected'], [
      '20261011230000_module_activations',
      '20261012120000_quota_modes',
    ], 'Phase 2 baseline')).toThrow(/missing=\[20261012120000_quota_modes\].*unexpected=\[unexpected\]/);
  });

  it('rejects duplicate migration rows', () => {
    expect(() => assertMigrationSet(['migration-a', 'migration-a'], ['migration-a', 'migration-b'], 'baseline')).toThrow(/missing=\[migration-b\].*unexpected=\[migration-a\]/);
  });
});
