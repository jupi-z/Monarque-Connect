export type FairScalePlanCode = 'CONNECT' | 'OPERATIONS' | 'BUSINESS' | 'ENTERPRISE';
export type FairScaleBillingPeriod = 'MONTHLY' | 'YEARLY';
export type FairScalePromotion = 'NONE' | 'WELCOME_MONTHLY15' | 'ANNUAL20';

export interface FairScalePriceInput {
  baseAmountMinor: bigint;
  welcomeAmountMinor: bigint;
  annualDiscountAmountMinor: bigint;
  includedEstablishments: number;
  addonAmountMinor: bigint;
}

export interface FairScaleQuoteInput {
  planCode: FairScalePlanCode;
  billingPeriod: FairScaleBillingPeriod;
  activeEstablishments: number;
  price: FairScalePriceInput;
  promotion: FairScalePromotion;
}

export interface FairScaleQuoteAmounts {
  baseAmountMinor: bigint;
  discountAmountMinor: bigint;
  addonAmountMinor: bigint;
  totalAmountMinor: bigint;
  includedEstablishments: number;
  addonEstablishments: number;
}

export function calculateFairScaleQuote(input: FairScaleQuoteInput): FairScaleQuoteAmounts {
  assertNonNegativeInteger(input.activeEstablishments, 'activeEstablishments');
  assertNonNegativeInteger(input.price.includedEstablishments, 'includedEstablishments');
  assertNonNegative(input.price.baseAmountMinor, 'baseAmountMinor');
  assertNonNegative(input.price.welcomeAmountMinor, 'welcomeAmountMinor');
  assertNonNegative(input.price.annualDiscountAmountMinor, 'annualDiscountAmountMinor');
  assertNonNegative(input.price.addonAmountMinor, 'addonAmountMinor');

  if (input.price.welcomeAmountMinor > input.price.baseAmountMinor) throw new Error('welcomeAmountMinor cannot exceed baseAmountMinor');
  if (input.price.annualDiscountAmountMinor > input.price.baseAmountMinor) throw new Error('annualDiscountAmountMinor cannot exceed baseAmountMinor');
  if (input.promotion === 'WELCOME_MONTHLY15' && input.billingPeriod !== 'MONTHLY') throw new Error('WELCOME_MONTHLY15 requires MONTHLY billing');
  if (input.promotion === 'ANNUAL20' && input.billingPeriod !== 'YEARLY') throw new Error('ANNUAL20 requires YEARLY billing');

  const addonEstablishments = Math.max(0, input.activeEstablishments - input.price.includedEstablishments);
  let discountAmountMinor = 0n;
  if (input.promotion === 'WELCOME_MONTHLY15') discountAmountMinor = input.price.baseAmountMinor - input.price.welcomeAmountMinor;
  if (input.promotion === 'ANNUAL20') discountAmountMinor = input.price.annualDiscountAmountMinor;

  const addonAmountMinor = BigInt(addonEstablishments) * input.price.addonAmountMinor;
  const totalAmountMinor = input.price.baseAmountMinor - discountAmountMinor + addonAmountMinor;
  return {
    baseAmountMinor: input.price.baseAmountMinor,
    discountAmountMinor,
    addonAmountMinor,
    totalAmountMinor,
    includedEstablishments: input.price.includedEstablishments,
    addonEstablishments,
  };
}

function assertNonNegative(value: bigint, name: string): void {
  if (value < 0n) throw new Error(`${name} must be non-negative`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
}
