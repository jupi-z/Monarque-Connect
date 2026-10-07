import { describe, expect, it } from 'vitest';
import { assertPasswordPolicy, normalizeEmail } from '../../src/auth/identity.js';

describe('identity primitives', () => {
  it('normalizes email for all identity lookups', () => {
    expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com');
  });

  it('rejects passwords outside the documented policy', () => {
    expect(() => assertPasswordPolicy('short')).toThrow();
    expect(() => assertPasswordPolicy('p'.repeat(257))).toThrow();
    expect(() => assertPasswordPolicy('p'.repeat(12))).not.toThrow();
  });
});
