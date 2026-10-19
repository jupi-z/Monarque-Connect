import type { BillingPeriod } from '@prisma/client';

/**
 * Adds a billing period in UTC while preserving the end-of-month intent.
 * PostgreSQL and JavaScript both otherwise turn 31 January + 1 month into a
 * date in March. Billing periods must never drift because of that behaviour.
 */
export function addBillingPeriod(date: Date, period: BillingPeriod): Date {
  if (Number.isNaN(date.getTime())) throw new Error('Billing date must be valid');
  const result = new Date(date);
  if (period === 'YEARLY') {
    const month = result.getUTCMonth();
    const day = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCFullYear(result.getUTCFullYear() + 1);
    result.setUTCMonth(month);
    result.setUTCDate(Math.min(day, daysInMonth(result.getUTCFullYear(), month)));
    return result;
  }

  const day = result.getUTCDate();
  const targetMonth = result.getUTCMonth() + 1;
  result.setUTCDate(1);
  result.setUTCMonth(targetMonth);
  result.setUTCDate(Math.min(day, daysInMonth(result.getUTCFullYear(), result.getUTCMonth())));
  return result;
}

export function billingPeriodKey(termId: string, periodStart: Date, periodEnd: Date): string {
  return `billing-renewal:${termId}:${periodStart.toISOString()}:${periodEnd.toISOString()}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
