import { Prisma } from '@prisma/client';
import type { SalesLineCalculationInput, SalesLineCalculationResult } from './sales.types.js';
import { TaxMode } from './sales.types.js';

const Decimal = Prisma.Decimal;
const MONEY_SCALE = 4;
const ROUNDING = Decimal.ROUND_HALF_UP;

function parseNonNegative(value: string, label: string): Prisma.Decimal {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`${label} must be a non-negative decimal string`);
  }

  const parsed = new Decimal(value);
  if (!parsed.isFinite() || parsed.isNegative()) {
    throw new Error(`${label} must be a non-negative decimal string`);
  }
  return parsed;
}

function money(value: Prisma.Decimal): string {
  return value.toDecimalPlaces(MONEY_SCALE, ROUNDING).toFixed(MONEY_SCALE);
}

export class MoneyCalculator {
  calculateLine(input: SalesLineCalculationInput): SalesLineCalculationResult {
    if (!Object.values(TaxMode).includes(input.taxMode)) {
      throw new Error(`Tax mode is not supported: ${String(input.taxMode)}`);
    }

    const quantity = parseNonNegative(input.quantity, 'Quantity');
    if (quantity.isZero()) {
      throw new Error('Quantity must be greater than zero');
    }

    const unitPrice = parseNonNegative(input.unitPrice, 'Unit price');
    const discountAmount = parseNonNegative(input.discountAmount, 'Discount');
    const taxRate = parseNonNegative(input.taxRate, 'Tax rate');

    const lineAmount = quantity.mul(unitPrice);
    const netBeforeTax = lineAmount.sub(discountAmount);
    if (netBeforeTax.isNegative()) {
      throw new Error('Discount cannot exceed the line amount');
    }

    if (input.taxMode === TaxMode.INCLUSIVE) {
      const gross = netBeforeTax.toDecimalPlaces(MONEY_SCALE, ROUNDING);
      const tax = taxRate.isZero()
        ? new Decimal(0)
        : gross.mul(taxRate).div(new Decimal(100).add(taxRate)).toDecimalPlaces(MONEY_SCALE, ROUNDING);
      return {
        netAmount: money(gross.sub(tax)),
        taxAmount: money(tax),
        grossAmount: money(gross),
      };
    }

    const net = netBeforeTax.toDecimalPlaces(MONEY_SCALE, ROUNDING);
    const tax = input.taxMode === TaxMode.EXCLUSIVE
      ? net.mul(taxRate).div(100).toDecimalPlaces(MONEY_SCALE, ROUNDING)
      : new Decimal(0);

    return {
      netAmount: money(net),
      taxAmount: money(tax),
      grossAmount: money(net.add(tax)),
    };
  }

  assertCurrencyMatch(expectedCurrency: string, actualCurrency: string): void {
    if (expectedCurrency.trim().toUpperCase() !== actualCurrency.trim().toUpperCase()) {
      throw new Error(`Currency mismatch: expected ${expectedCurrency}, received ${actualCurrency}`);
    }
  }
}
