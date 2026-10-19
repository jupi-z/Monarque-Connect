import { describe, expect, it } from 'vitest';
import { calculateFairScaleQuote } from '../../src/billing/fairscale-pricing.js';

describe('FairScale deterministic pricing', () => {
  it('calculates the regular monthly BUSINESS price and establishment add-ons in cents', () => {
    expect(calculateFairScaleQuote({
      planCode: 'BUSINESS',
      billingPeriod: 'MONTHLY',
      activeEstablishments: 5,
      price: {
        baseAmountMinor: 4500n,
        welcomeAmountMinor: 3825n,
        annualDiscountAmountMinor: 0n,
        includedEstablishments: 3,
        addonAmountMinor: 1000n,
      },
      promotion: 'NONE',
    })).toEqual({
      baseAmountMinor: 4500n,
      discountAmountMinor: 0n,
      addonAmountMinor: 2000n,
      totalAmountMinor: 6500n,
      includedEstablishments: 3,
      addonEstablishments: 2,
    });
  });

  it('applies a welcome discount only to the base plan', () => {
    expect(calculateFairScaleQuote({
      planCode: 'BUSINESS',
      billingPeriod: 'MONTHLY',
      activeEstablishments: 4,
      price: {
        baseAmountMinor: 4500n,
        welcomeAmountMinor: 3825n,
        annualDiscountAmountMinor: 0n,
        includedEstablishments: 3,
        addonAmountMinor: 1000n,
      },
      promotion: 'WELCOME_MONTHLY15',
    }).totalAmountMinor).toBe(4825n);
  });

  it('uses the annual catalog discount without floating point arithmetic', () => {
    expect(calculateFairScaleQuote({
      planCode: 'BUSINESS',
      billingPeriod: 'YEARLY',
      activeEstablishments: 3,
      price: {
        baseAmountMinor: 54000n,
        welcomeAmountMinor: 43200n,
        annualDiscountAmountMinor: 10800n,
        includedEstablishments: 3,
        addonAmountMinor: 12000n,
      },
      promotion: 'ANNUAL20',
    })).toMatchObject({
      discountAmountMinor: 10800n,
      totalAmountMinor: 43200n,
      addonEstablishments: 0,
    });
  });

  it('rejects negative or non-integral inputs before any amount is persisted', () => {
    expect(() => calculateFairScaleQuote({
      planCode: 'BUSINESS',
      billingPeriod: 'MONTHLY',
      activeEstablishments: -1,
      price: {
        baseAmountMinor: 4500n,
        welcomeAmountMinor: 3825n,
        annualDiscountAmountMinor: 0n,
        includedEstablishments: 3,
        addonAmountMinor: 1000n,
      },
      promotion: 'NONE',
    })).toThrow('activeEstablishments');
  });
});
