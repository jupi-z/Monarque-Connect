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

