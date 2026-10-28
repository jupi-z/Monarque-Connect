import { describe, expect, it } from 'vitest';
import { convertMeasureQuantity } from '../../src/referentials/measure-conversion.js';

const kg = { code: 'KG', dimension: 'MASS', baseUnitCode: 'KG', numerator: 1n, denominator: 1n };
const gram = { code: 'G', dimension: 'MASS', baseUnitCode: 'KG', numerator: 1n, denominator: 1000n };
const litre = { code: 'L', dimension: 'VOLUME', baseUnitCode: 'L', numerator: 1n, denominator: 1n };
const millilitre = { code: 'ML', dimension: 'VOLUME', baseUnitCode: 'L', numerator: 1n, denominator: 1000n };

describe('exact measure conversion', () => {
  it('normalizes the reference purchase exactly and converts back without floating point', () => {
    expect(convertMeasureQuantity('125', gram, kg)).toBe('0.125');
    expect(convertMeasureQuantity('0.125', kg, gram)).toBe('125');
    expect(convertMeasureQuantity('250.5', millilitre, litre)).toBe('0.2505');
  });

  it('rejects incompatible dimensions, non-positive values, malformed scales, and non-terminating conversions', () => {
    expect(() => convertMeasureQuantity('1', kg, litre)).toThrow(/incompatible/);
    expect(() => convertMeasureQuantity('0', gram, kg)).toThrow(/positive/);
    expect(() => convertMeasureQuantity('-1', gram, kg)).toThrow(/positive/);
    expect(() => convertMeasureQuantity('1.0000000000001', gram, kg)).toThrow(/positive/);
    expect(() => convertMeasureQuantity('1', { ...kg, numerator: 1n, denominator: 3n }, kg)).toThrow(/represented exactly/);
    expect(() => convertMeasureQuantity('1', { ...kg, numerator: 1_000_000_000_000_000n, denominator: 1n }, kg)).toThrow(/NUMERIC\(24,12\)/);
  });
});
