import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { convertMeasureQuantity, type RationalMeasure } from '../referentials/measure-conversion.js';

// A private Decimal.js constructor prevents C3 from mutating the process-wide
// arithmetic context used by legacy Sales and FairScale Billing.
const Decimal = Prisma.Decimal.clone({ precision: 80, rounding: Prisma.Decimal.ROUND_HALF_UP });
const PRICE = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,8})?$/;
const RATE = /^(?:0|[1-9]\d{0,5})(?:\.\d{1,18})?$/;

export interface CommercialPricingCalculationInput {
  quantity: string;
  inputUnit: RationalMeasure;
  priceUnit: RationalMeasure;
  unitPrice: string;
  sourceCurrencyCode: string;
  targetCurrencyCode: string;
  sourceCurrencyDigits: number;
  targetCurrencyDigits: number;
  fxRate?: string;
  fxBaseCurrencyCode?: string;
  fxQuoteCurrencyCode?: string;
}

export interface CommercialPricingCalculationResult {
  quantityInPriceUnit: string;
  sourceSubtotal: string;
  targetTotal: string;
}

/** Deterministic C3 V1 amount calculation. It does not apply taxes or discounts. */
export function calculateCommercialPrice(input: CommercialPricingCalculationInput): CommercialPricingCalculationResult {
  if (!Number.isInteger(input.sourceCurrencyDigits) || input.sourceCurrencyDigits < 0 || input.sourceCurrencyDigits > 4
    || !Number.isInteger(input.targetCurrencyDigits) || input.targetCurrencyDigits < 0 || input.targetCurrencyDigits > 4) {
    throw new BadRequestException('Currency precision is outside the supported range');
  }
  if (!/^[A-Z]{3}$/.test(input.sourceCurrencyCode) || !/^[A-Z]{3}$/.test(input.targetCurrencyCode)) {
    throw new BadRequestException('Currency codes must be canonical uppercase ISO-style codes');
  }
  if (input.sourceCurrencyCode === input.targetCurrencyCode) {
    if (input.fxRate !== undefined || input.fxBaseCurrencyCode !== undefined || input.fxQuoteCurrencyCode !== undefined
      || input.sourceCurrencyDigits !== input.targetCurrencyDigits) {
      throw new BadRequestException('Same-currency pricing must not apply FX or conflicting currency precision');
    }
  } else if (input.fxRate === undefined || input.fxBaseCurrencyCode !== input.sourceCurrencyCode || input.fxQuoteCurrencyCode !== input.targetCurrencyCode) {
    throw new BadRequestException('A correctly directed verified FX rate is required when converting between currencies');
  }
  if (input.fxRate !== undefined && (typeof input.fxRate !== 'string' || !RATE.test(input.fxRate) || new Decimal(input.fxRate).lte(0))) {
    throw new BadRequestException('FX rate must be positive with at most 6 integer and 18 fractional digits');
  }
  if (typeof input.unitPrice !== 'string' || !PRICE.test(input.unitPrice) || new Decimal(input.unitPrice).lte(0)) {
    throw new BadRequestException('Price must be a positive decimal with at most 16 integer and 8 fractional digits');
  }
  const quantityInPriceUnit = convertMeasureQuantity(input.quantity, input.inputUnit, input.priceUnit);
  const unrounded = new Decimal(quantityInPriceUnit).mul(input.unitPrice);
  const sourceSubtotal = unrounded.toDecimalPlaces(input.sourceCurrencyDigits, Decimal.ROUND_HALF_UP);

  let targetTotal = sourceSubtotal;
  if (input.fxRate !== undefined) {
    if (typeof input.fxRate !== 'string' || !RATE.test(input.fxRate) || new Decimal(input.fxRate).lte(0)) {
      throw new BadRequestException('FX rate must be positive with at most 6 integer and 18 fractional digits');
    }
    targetTotal = sourceSubtotal.mul(input.fxRate).toDecimalPlaces(input.targetCurrencyDigits, Decimal.ROUND_HALF_UP);
  }

  return {
    quantityInPriceUnit,
    sourceSubtotal: sourceSubtotal.toFixed(input.sourceCurrencyDigits),
    targetTotal: targetTotal.toFixed(input.targetCurrencyDigits),
  };
}


export interface ResolvedCommercialDiscount {
  code: string;
  amount: string;
}

export interface ResolvedCommercialTax {
  code: string;
  version: number;
  rate: string;
  calculationCurrency: 'SOURCE' | 'TARGET';
}

export interface CommercialQuoteCalculationInput extends CommercialPricingCalculationInput {
  discounts?: ResolvedCommercialDiscount[];
  taxes?: ResolvedCommercialTax[];
}

export interface CommercialQuoteCalculationResult {
  quantityInPriceUnit: string;
  sourceCurrencyCode: string;
  targetCurrencyCode: string;
  sourceSubtotal: string;
  discountAmount: string;
  sourceNetAmount: string;
  taxes: Array<{
    code: string;
    version: number;
    calculationCurrency: 'SOURCE' | 'TARGET';
    currencyCode: string;
    amount: string;
  }>;
  sourceTotal: string | null;
  targetTotal: string;
}

const DISCOUNT_AMOUNT = /^(?:0|[1-9]\d{0,36})(?:\.\d{1,28})?$/;
const DISCOUNT_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const TAX_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Calculates one server-resolved commercial quote line. Discounts and taxes are
 * supplied only after policy resolution; this function never trusts client prices.
 */
export function calculateCommercialQuote(input: CommercialQuoteCalculationInput): CommercialQuoteCalculationResult {
  const currencyDigits = (value: number): boolean => Number.isInteger(value) && value >= 0 && value <= 4;
  if (!currencyDigits(input.sourceCurrencyDigits) || !currencyDigits(input.targetCurrencyDigits)) {
    throw new BadRequestException('Currency precision is outside the supported range');
  }
  if (!/^[A-Z]{3}$/.test(input.sourceCurrencyCode) || !/^[A-Z]{3}$/.test(input.targetCurrencyCode)) {
    throw new BadRequestException('Currency codes must be canonical uppercase ISO-style codes');
  }
  if (input.sourceCurrencyCode === input.targetCurrencyCode) {
    if (input.fxRate !== undefined || input.fxBaseCurrencyCode !== undefined || input.fxQuoteCurrencyCode !== undefined
      || input.sourceCurrencyDigits !== input.targetCurrencyDigits) {
      throw new BadRequestException('Same-currency pricing must not apply FX or conflicting currency precision');
    }
  } else if (input.fxRate === undefined || input.fxBaseCurrencyCode !== input.sourceCurrencyCode || input.fxQuoteCurrencyCode !== input.targetCurrencyCode) {
    throw new BadRequestException('A correctly directed verified FX rate is required when converting between currencies');
  }
  if (input.fxRate !== undefined && (typeof input.fxRate !== 'string' || !RATE.test(input.fxRate) || new Decimal(input.fxRate).lte(0))) {
    throw new BadRequestException('FX rate must be positive with at most 6 integer and 18 fractional digits');
  }
  if (typeof input.unitPrice !== 'string' || !PRICE.test(input.unitPrice) || new Decimal(input.unitPrice).lte(0)) {
    throw new BadRequestException('Price must be a positive decimal with at most 16 integer and 8 fractional digits');
  }

  const quantityInPriceUnit = convertMeasureQuantity(input.quantity, input.inputUnit, input.priceUnit);
  const sourceSubtotal = new Decimal(quantityInPriceUnit).mul(input.unitPrice).toDecimalPlaces(input.sourceCurrencyDigits, Decimal.ROUND_HALF_UP);
  const discounts = input.discounts === undefined ? [] : input.discounts;
  if (!Array.isArray(discounts) || discounts.length > 100) throw new BadRequestException('Discount rules are invalid');
  const discountCodes = new Set<string>();
  let resolvedDiscountTotal = new Decimal(0);
  for (const discount of discounts) {
    if (!discount || typeof discount.code !== 'string' || !DISCOUNT_CODE.test(discount.code) || discountCodes.has(discount.code)
      || typeof discount.amount !== 'string' || !DISCOUNT_AMOUNT.test(discount.amount)) {
      throw new BadRequestException('Resolved discount is invalid or duplicated');
    }
    discountCodes.add(discount.code);
    resolvedDiscountTotal = resolvedDiscountTotal.plus(discount.amount);
  }
  if (resolvedDiscountTotal.gt(sourceSubtotal)) throw new BadRequestException('Resolved discounts cannot exceed the source subtotal');

  const sourceNetAmount = sourceSubtotal.minus(resolvedDiscountTotal).toDecimalPlaces(input.sourceCurrencyDigits, Decimal.ROUND_HALF_UP);
  const discountAmount = sourceSubtotal.minus(sourceNetAmount);
  const taxes = input.taxes === undefined ? [] : input.taxes;
  if (!Array.isArray(taxes) || taxes.length > 100) throw new BadRequestException('Tax rules are invalid');
  const taxCodes = new Set<string>();
  if (taxes.some((tax) => !tax || (tax.calculationCurrency !== 'SOURCE' && tax.calculationCurrency !== 'TARGET'))) {
    throw new BadRequestException('Resolved tax calculation currency is invalid');
  }
  const taxMode = taxes[0]?.calculationCurrency;
  if (taxMode !== undefined && taxes.some((tax) => tax.calculationCurrency !== taxMode)) {
    throw new BadRequestException('SOURCE and TARGET tax policies cannot be mixed in one quote');
  }
  const taxLines: CommercialQuoteCalculationResult['taxes'] = [];
  let sourceTaxTotal = new Decimal(0);
  let targetTaxTotal = new Decimal(0);
  let targetNetAmount = sourceNetAmount;

  if (taxMode === 'TARGET' && input.fxRate !== undefined) {
    targetNetAmount = sourceNetAmount.mul(input.fxRate).toDecimalPlaces(input.targetCurrencyDigits, Decimal.ROUND_HALF_UP);
  } else if (taxMode === 'TARGET' && input.sourceCurrencyCode !== input.targetCurrencyCode) {
    throw new BadRequestException('A verified FX rate is required for target-currency tax calculation');
  }

  for (const tax of taxes) {
    if (!TAX_CODE.test(tax.code) || taxCodes.has(tax.code) || !Number.isInteger(tax.version) || tax.version < 1
      || typeof tax.rate !== 'string' || !RATE.test(tax.rate)) {
      throw new BadRequestException('Resolved tax policy is invalid or duplicated');
    }
    taxCodes.add(tax.code);
    const rate = new Decimal(tax.rate);
    const currencyCode = tax.calculationCurrency === 'SOURCE' ? input.sourceCurrencyCode : input.targetCurrencyCode;
    const amount = (tax.calculationCurrency === 'SOURCE' ? sourceNetAmount : targetNetAmount)
      .mul(rate).toDecimalPlaces(tax.calculationCurrency === 'SOURCE' ? input.sourceCurrencyDigits : input.targetCurrencyDigits, Decimal.ROUND_HALF_UP);
    taxLines.push({ code: tax.code, version: tax.version, calculationCurrency: tax.calculationCurrency, currencyCode, amount: amount.toFixed(tax.calculationCurrency === 'SOURCE' ? input.sourceCurrencyDigits : input.targetCurrencyDigits) });
    if (tax.calculationCurrency === 'SOURCE') sourceTaxTotal = sourceTaxTotal.plus(amount);
    else targetTaxTotal = targetTaxTotal.plus(amount);
  }

  let sourceTotal: string | null;
  let targetTotal: Prisma.Decimal;
  if (taxMode === 'TARGET') {
    sourceTotal = null;
    targetTotal = targetNetAmount.plus(targetTaxTotal);
  } else {
    sourceTotal = sourceNetAmount.plus(sourceTaxTotal).toFixed(input.sourceCurrencyDigits);
    const sourceTotalDecimal = new Decimal(sourceTotal);
    targetTotal = input.fxRate === undefined
      ? sourceTotalDecimal
      : sourceTotalDecimal.mul(input.fxRate).toDecimalPlaces(input.targetCurrencyDigits, Decimal.ROUND_HALF_UP);
  }

  return {
    quantityInPriceUnit,
    sourceCurrencyCode: input.sourceCurrencyCode,
    targetCurrencyCode: input.targetCurrencyCode,
    sourceSubtotal: sourceSubtotal.toFixed(input.sourceCurrencyDigits),
    discountAmount: discountAmount.toFixed(input.sourceCurrencyDigits),
    sourceNetAmount: sourceNetAmount.toFixed(input.sourceCurrencyDigits),
    taxes: taxLines,
    sourceTotal,
    targetTotal: targetTotal.toFixed(input.targetCurrencyDigits),
  };
}
