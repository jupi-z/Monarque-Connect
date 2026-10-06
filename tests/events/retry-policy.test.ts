import { describe, expect, it } from 'vitest';
import { nextRetryAt } from '../../src/events/retry-policy.js';

describe('nextRetryAt', () => {
  it('uses the bounded 1s, 5s, 30s, 2m, 5m schedule', () => {
    const now = new Date('2026-10-06T19:00:00.000Z');

    expect(nextRetryAt(1, now).toISOString()).toBe('2026-10-06T19:00:01.000Z');
    expect(nextRetryAt(2, now).toISOString()).toBe('2026-10-06T19:00:05.000Z');
    expect(nextRetryAt(3, now).toISOString()).toBe('2026-10-06T19:00:30.000Z');
    expect(nextRetryAt(4, now).toISOString()).toBe('2026-10-06T19:02:00.000Z');
    expect(nextRetryAt(8, now).toISOString()).toBe('2026-10-06T19:05:00.000Z');
  });
});
