import { describe, expect, it } from 'vitest';
import { isProductCode, PRODUCT_CODES } from '../../src/products/product-code.js';

describe('server product-code contract', () => {
  it('recognizes only the initially approved product identifiers', () => {
    expect(PRODUCT_CODES).toEqual(['MONARQUE_CONNECT', 'ZAMUREK']);
    expect(isProductCode('MONARQUE_CONNECT')).toBe(true);
    expect(isProductCode('ZAMUREK')).toBe(true);
  });

  it('rejects client supplied or misspelled identifiers without coercion', () => {
    for (const value of ['CONNECT', 'monarque_connect', 'ENTERPRISE', '', null, 12, {}, undefined]) {
      expect(isProductCode(value)).toBe(false);
    }
  });
});
