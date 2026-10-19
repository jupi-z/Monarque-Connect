import { describe, expect, it } from 'vitest';
import { addBillingPeriod, billingPeriodKey } from '../../src/billing/billing-period.js';

describe('FairScale billing periods', () => {
  it.each([
    ['2024-01-31T00:00:00.000Z', '2024-02-29T00:00:00.000Z'],
    ['2026-01-31T00:00:00.000Z', '2026-02-28T00:00:00.000Z'],
    ['2026-03-31T00:00:00.000Z', '2026-04-30T00:00:00.000Z'],
  ])('clamps monthly anniversaries without drifting', (input, expected) => {
    expect(addBillingPeriod(new Date(input), 'MONTHLY').toISOString()).toBe(expected);
  });

  it('preserves leap-day annual anniversaries', () => {
    expect(addBillingPeriod(new Date('2024-02-29T00:00:00.000Z'), 'YEARLY').toISOString()).toBe('2025-02-28T00:00:00.000Z');
  });

  it('builds a stable tenant-scoped renewal key', () => {
    expect(billingPeriodKey('term-1', new Date('2026-01-01T00:00:00.000Z'), new Date('2026-02-01T00:00:00.000Z'))).toBe('billing-renewal:term-1:2026-01-01T00:00:00.000Z:2026-02-01T00:00:00.000Z');
  });
});
