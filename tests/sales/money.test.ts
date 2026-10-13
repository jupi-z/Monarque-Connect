import { describe, expect, it } from 'vitest';
import { MoneyCalculator } from '../../src/sales/money.js';
import { TaxMode } from '../../src/sales/sales.types.js';

describe('MoneyCalculator', () => {
  const calculator = new MoneyCalculator();

  it('rounds monetary results HALF_UP to four decimal places without binary floating point', () => {
    expect(
      calculator.calculateLine({
        quantity: '2',
        unitPrice: '10.005',
        discountAmount: '0',
        taxMode: TaxMode.EXEMPT,
        taxRate: '0',
      }),
    ).toEqual({ netAmount: '20.0100', taxAmount: '0.0000', grossAmount: '20.0100' });

    expect(
      calculator.calculateLine({
        quantity: '1',
        unitPrice: '1.005',
        discountAmount: '0',
        taxMode: TaxMode.EXEMPT,
        taxRate: '0',
      }).netAmount,
    ).toBe('1.0050');

    expect(
      calculator.calculateLine({
        quantity: '1',
        unitPrice: '1.0051',
        discountAmount: '0',
        taxMode: TaxMode.EXEMPT,
        taxRate: '0',
      }).netAmount,
    ).toBe('1.0051');

    expect(
      calculator.calculateLine({
        quantity: '1',
        unitPrice: '1.00505',
        discountAmount: '0',
        taxMode: TaxMode.EXEMPT,
        taxRate: '0',
      }).netAmount,
    ).toBe('1.0051');
  });

  it('supports explicit exclusive, inclusive, exempt and not-applicable tax modes', () => {
    expect(calculator.calculateLine({ quantity: '1', unitPrice: '100', discountAmount: '0', taxMode: TaxMode.EXCLUSIVE, taxRate: '20' })).toEqual({
      netAmount: '100.0000',
      taxAmount: '20.0000',
      grossAmount: '120.0000',
    });
    expect(calculator.calculateLine({ quantity: '1', unitPrice: '120', discountAmount: '0', taxMode: TaxMode.INCLUSIVE, taxRate: '20' })).toEqual({
      netAmount: '100.0000',
      taxAmount: '20.0000',
      grossAmount: '120.0000',
    });
    expect(calculator.calculateLine({ quantity: '1', unitPrice: '100', discountAmount: '5', taxMode: TaxMode.EXEMPT, taxRate: '20' })).toEqual({
      netAmount: '95.0000',
      taxAmount: '0.0000',
      grossAmount: '95.0000',
    });
    expect(calculator.calculateLine({ quantity: '1', unitPrice: '100', discountAmount: '0', taxMode: TaxMode.NOT_APPLICABLE, taxRate: '20' })).toEqual({
      netAmount: '100.0000',
      taxAmount: '0.0000',
      grossAmount: '100.0000',
    });
  });

  it('rejects non-positive quantities and negative monetary inputs', () => {
    expect(() => calculator.calculateLine({ quantity: '0', unitPrice: '10', discountAmount: '0', taxMode: TaxMode.EXCLUSIVE, taxRate: '20' })).toThrow(/quantity/i);
    expect(() => calculator.calculateLine({ quantity: '-1', unitPrice: '10', discountAmount: '0', taxMode: TaxMode.EXCLUSIVE, taxRate: '20' })).toThrow(/quantity/i);
    expect(() => calculator.calculateLine({ quantity: '1', unitPrice: '-10', discountAmount: '0', taxMode: TaxMode.EXCLUSIVE, taxRate: '20' })).toThrow(/unit price/i);
    expect(() => calculator.calculateLine({ quantity: '1', unitPrice: '10', discountAmount: '-1', taxMode: TaxMode.EXCLUSIVE, taxRate: '20' })).toThrow(/discount/i);
    expect(() => calculator.calculateLine({ quantity: '1', unitPrice: '10', discountAmount: '11', taxMode: TaxMode.EXCLUSIVE, taxRate: '20' })).toThrow(/discount/i);
    expect(() => calculator.calculateLine({ quantity: '1', unitPrice: '10', discountAmount: '0', taxMode: TaxMode.EXCLUSIVE, taxRate: '-1' })).toThrow(/tax/i);
  });

  it('requires equal currencies when comparing document and line currency', () => {
    expect(() => calculator.assertCurrencyMatch('EUR', 'USD')).toThrow(/currency/i);
    expect(() => calculator.assertCurrencyMatch('EUR', 'eur')).not.toThrow();
  });

  it('rejects tax modes outside the explicit contract', () => {
    expect(() => calculator.calculateLine({
      quantity: '1',
      unitPrice: '10',
      discountAmount: '0',
      taxMode: 'UNKNOWN' as TaxMode,
      taxRate: '20',
    })).toThrow(/tax mode/i);
  });
});
