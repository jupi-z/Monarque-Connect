import { describe, expect, it } from 'vitest';
import { calculateCommercialPrice } from '../../src/pricing/pricing-calculator.js';

const kg = { code: 'KG', dimension: 'MASS', baseUnitCode: 'KG', numerator: 1n, denominator: 1n };
const gram = { code: 'G', dimension: 'MASS', baseUnitCode: 'KG', numerator: 1n, denominator: 1000n };

describe('commercial pricing calculator', () => {
  it('calculates exact unit conversion and USD to CDF reference without binary floats', () => {
    const result = calculateCommercialPrice({
      quantity: '125', inputUnit: gram, priceUnit: kg, unitPrice: '20', sourceCurrencyDigits: 2,
      sourceCurrencyCode: 'USD', targetCurrencyCode: 'CDF', targetCurrencyDigits: 2, fxRate: '2360',
      fxBaseCurrencyCode: 'USD', fxQuoteCurrencyCode: 'CDF',
    });

    expect(result.quantityInPriceUnit).toBe('0.125');
    expect(result.sourceSubtotal).toBe('2.50');
    expect(result.targetTotal).toBe('5900.00');
  });

  it('uses explicit HALF_UP rounding at the currency boundary', () => {
    const result = calculateCommercialPrice({
      quantity: '1', inputUnit: kg, priceUnit: kg, unitPrice: '1.005', sourceCurrencyDigits: 2,
      sourceCurrencyCode: 'USD', targetCurrencyCode: 'USD', targetCurrencyDigits: 2,
    });
    expect(result.sourceSubtotal).toBe('1.01');
    expect(result.targetTotal).toBe('1.01');
  });

  it('rejects malformed, non-positive and dimensionally incompatible inputs', () => {
    const base = { quantity: '1', inputUnit: kg, priceUnit: kg, sourceCurrencyCode: 'USD', targetCurrencyCode: 'USD', sourceCurrencyDigits: 2, targetCurrencyDigits: 2 };
    expect(() => calculateCommercialPrice({ ...base, quantity: '1e2', unitPrice: '20' })).toThrow(/quantity/i);
    expect(() => calculateCommercialPrice({ ...base, unitPrice: '0' })).toThrow(/price/i);
    expect(() => calculateCommercialPrice({ ...base, inputUnit: gram, priceUnit: { ...kg, dimension: 'VOLUME' }, unitPrice: '20' })).toThrow(/incompatible/i);
    expect(() => calculateCommercialPrice({ ...base, unitPrice: '20', sourceCurrencyCode: 'USD', targetCurrencyCode: 'CDF' })).toThrow(/FX rate is required/i);
    expect(() => calculateCommercialPrice({ ...base, unitPrice: '20', fxRate: '0' })).toThrow(/FX/i);
    expect(() => calculateCommercialPrice({ ...base, unitPrice: '20', sourceCurrencyCode: 'USD', targetCurrencyCode: 'CDF', fxRate: '2360', fxBaseCurrencyCode: 'CDF', fxQuoteCurrencyCode: 'USD' })).toThrow(/directed/i);
    expect(() => calculateCommercialPrice({ ...base, unitPrice: '20', sourceCurrencyDigits: 2, targetCurrencyDigits: 0 })).toThrow(/precision/i);
  });
});
