import { describe, expect, it } from 'vitest';
import { calculateCommercialQuote } from '../../src/pricing/pricing-calculator.js';
import type { RationalMeasure } from '../../src/referentials/measure-conversion.js';

const kg: RationalMeasure = { code: 'KG', dimension: 'MASS', baseUnitCode: 'KG', numerator: 1n, denominator: 1n };
const gram: RationalMeasure = { code: 'G', dimension: 'MASS', baseUnitCode: 'KG', numerator: 1n, denominator: 1000n };

type QuoteCalculationInput = {
  quantity: string;
  inputUnit: RationalMeasure;
  priceUnit: RationalMeasure;
  unitPrice: string;
  sourceCurrencyCode: string;
  sourceCurrencyDigits: number;
  targetCurrencyCode: string;
  targetCurrencyDigits: number;
  discounts?: Array<{ code: string; amount: string }>;
  taxes?: Array<{ code: string; version: number; rate: string; calculationCurrency: 'SOURCE' | 'TARGET' }>;
  fxRate?: string;
  fxBaseCurrencyCode?: string;
  fxQuoteCurrencyCode?: string;
};

type QuoteCalculationResult = {
  quantityInPriceUnit: string;
  sourceSubtotal: string;
  discountAmount: string;
  sourceNetAmount: string;
  taxes: Array<{ code: string; version: number; calculationCurrency: 'SOURCE' | 'TARGET'; amount: string; currencyCode: string; taxableBase: string }>;
  sourceTotal: string | null;
  targetTotal: string;
};

function calculateQuote(input: QuoteCalculationInput): QuoteCalculationResult {
  return calculateCommercialQuote(input);
}

describe('commercial quote calculator', () => {
  it('calculates the 125 g × 20 USD/kg × 2,360 CDF/USD reference exactly', () => {
    const result = calculateQuote({
      quantity: '125', inputUnit: gram, priceUnit: kg, unitPrice: '20',
      sourceCurrencyCode: 'USD', sourceCurrencyDigits: 2,
      targetCurrencyCode: 'CDF', targetCurrencyDigits: 2,
      fxRate: '2360', fxBaseCurrencyCode: 'USD', fxQuoteCurrencyCode: 'CDF',
    });

    expect(result).toMatchObject({
      quantityInPriceUnit: '0.125',
      sourceSubtotal: '2.50',
      discountAmount: '0.00',
      sourceNetAmount: '2.50',
      taxes: [],
      sourceTotal: '2.50',
      targetTotal: '5900.00',
    });
  });

  it('applies resolved discounts before source-currency tax and rounds at each declared boundary', () => {
    const result = calculateQuote({
      quantity: '1', inputUnit: kg, priceUnit: kg, unitPrice: '100',
      sourceCurrencyCode: 'USD', sourceCurrencyDigits: 2,
      targetCurrencyCode: 'USD', targetCurrencyDigits: 2,
      discounts: [{ code: 'SERVER_APPROVED', amount: '10' }],
      taxes: [{ code: 'CONFIGURED_TAX', version: 3, rate: '0.1', calculationCurrency: 'SOURCE' }],
    });

    expect(result).toMatchObject({
      sourceSubtotal: '100.00',
      discountAmount: '10.00',
      sourceNetAmount: '90.00',
      taxes: [{ code: 'CONFIGURED_TAX', version: 3, calculationCurrency: 'SOURCE', taxableBase: '90.00', amount: '9.00', currencyCode: 'USD' }],
      sourceTotal: '99.00',
      targetTotal: '99.00',
    });
  });

  it('adds SOURCE-currency tax before converting the final source total', () => {
    const result = calculateQuote({
      quantity: '1', inputUnit: kg, priceUnit: kg, unitPrice: '100',
      sourceCurrencyCode: 'USD', sourceCurrencyDigits: 2,
      targetCurrencyCode: 'CDF', targetCurrencyDigits: 2,
      taxes: [{ code: 'SOURCE_TAX', version: 1, rate: '0.1', calculationCurrency: 'SOURCE' }],
      fxRate: '2', fxBaseCurrencyCode: 'USD', fxQuoteCurrencyCode: 'CDF',
    });

    expect(result).toMatchObject({
      sourceSubtotal: '100.00',
      sourceNetAmount: '100.00',
      taxes: [{ code: 'SOURCE_TAX', version: 1, calculationCurrency: 'SOURCE', taxableBase: '100.00', amount: '10.00', currencyCode: 'USD' }],
      sourceTotal: '110.00',
      targetTotal: '220.00',
    });
  });
  it('calculates TARGET taxes after conversion and does not invent a source total', () => {
    const result = calculateQuote({
      quantity: '125', inputUnit: gram, priceUnit: kg, unitPrice: '20',
      sourceCurrencyCode: 'USD', sourceCurrencyDigits: 2,
      targetCurrencyCode: 'CDF', targetCurrencyDigits: 2,
      taxes: [{ code: 'TARGET_TAX', version: 1, rate: '0.1', calculationCurrency: 'TARGET' }],
      fxRate: '2360', fxBaseCurrencyCode: 'USD', fxQuoteCurrencyCode: 'CDF',
    });

    expect(result).toMatchObject({
      sourceSubtotal: '2.50',
      sourceNetAmount: '2.50',
      taxes: [{ code: 'TARGET_TAX', version: 1, calculationCurrency: 'TARGET', taxableBase: '5900.00', amount: '590.00', currencyCode: 'CDF' }],
      sourceTotal: null,
      targetTotal: '6490.00',
    });
  });

  it('rejects mixed source and target tax calculation modes', () => {
    expect(() => calculateQuote({
      quantity: '1', inputUnit: kg, priceUnit: kg, unitPrice: '10',
      sourceCurrencyCode: 'USD', sourceCurrencyDigits: 2,
      targetCurrencyCode: 'USD', targetCurrencyDigits: 2,
      taxes: [
        { code: 'SOURCE_TAX', version: 1, rate: '0.1', calculationCurrency: 'SOURCE' },
        { code: 'TARGET_TAX', version: 1, rate: '0.1', calculationCurrency: 'TARGET' },
      ],
    })).toThrow(/cannot be mixed/i);
  });

  it('rejects null tax or discount configuration instead of silently treating it as absent', () => {
    const base = {
      quantity: '1', inputUnit: kg, priceUnit: kg, unitPrice: '10',
      sourceCurrencyCode: 'USD', sourceCurrencyDigits: 2,
      targetCurrencyCode: 'USD', targetCurrencyDigits: 2,
    };
    expect(() => calculateQuote({ ...base, taxes: null as never })).toThrow(/tax rules are invalid/i);
    expect(() => calculateQuote({ ...base, discounts: null as never })).toThrow(/discount rules are invalid/i);
    expect(() => calculateQuote({ ...base, discounts: [null as never] })).toThrow(/discount is invalid/i);
  });
  it('rejects an unsupported tax calculation currency', () => {
    const invalidTax = { code: 'UNKNOWN_TAX', version: 1, rate: '0.1', calculationCurrency: 'OTHER' };
    expect(() => calculateQuote({
      quantity: '1', inputUnit: kg, priceUnit: kg, unitPrice: '10',
      sourceCurrencyCode: 'USD', sourceCurrencyDigits: 2,
      targetCurrencyCode: 'USD', targetCurrencyDigits: 2,
      taxes: [invalidTax as never],
    })).toThrow(/currency is invalid/i);
  });
  it('rejects resolved discounts whose sum exceeds the rounded source subtotal', () => {
    expect(() => calculateQuote({
      quantity: '1', inputUnit: kg, priceUnit: kg, unitPrice: '10',
      sourceCurrencyCode: 'USD', sourceCurrencyDigits: 2,
      targetCurrencyCode: 'USD', targetCurrencyDigits: 2,
      discounts: [{ code: 'INVALID_TOTAL', amount: '10.01' }],
    })).toThrow(/discount/i);
  });
});
