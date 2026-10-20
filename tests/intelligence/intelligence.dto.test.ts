import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  IntelligenceDashboardQuery,
  IntelligenceMetricsQuery,
} from '../../src/intelligence/intelligence.dto.js';

function invalidProperties(errors: Awaited<ReturnType<typeof validate>>): string[] {
  return errors.map((error) => error.property);
}

describe('Phase 10A Intelligence query DTOs', () => {
  it('accepts an exactly 366-day UTC dashboard window', async () => {
    const query = plainToInstance(IntelligenceDashboardQuery, {
      from: '2024-01-01T00:00:00Z',
      to: '2025-01-01T00:00:00Z',
    });

    expect(await validate(query)).toEqual([]);
  });

  it('rejects a dashboard window longer than 366 days or with an offset instead of UTC Z', async () => {
    const tooLong = plainToInstance(IntelligenceDashboardQuery, {
      from: '2024-01-01T00:00:00Z',
      to: '2025-01-02T00:00:00Z',
    });
    const nonUtc = plainToInstance(IntelligenceDashboardQuery, {
      from: '2024-01-01T00:00:00+01:00',
      to: '2024-01-02T00:00:00Z',
    });

    expect(invalidProperties(await validate(tooLong))).toContain('from');
    expect(invalidProperties(await validate(nonUtc))).toContain('from');
  });

  it('requires paired increasing activity bounds while allowing current-state-only queries', async () => {
    const unmatched = plainToInstance(IntelligenceMetricsQuery, { from: '2024-01-02T00:00:00Z' });
    const reversed = plainToInstance(IntelligenceMetricsQuery, {
      from: '2024-02-02T00:00:00Z',
      to: '2024-02-01T00:00:00Z',
    });
    const currentStateOnly = plainToInstance(IntelligenceMetricsQuery, {});

    expect(invalidProperties(await validate(unmatched))).toContain('from');
    expect(invalidProperties(await validate(reversed))).toContain('from');
    expect(await validate(currentStateOnly)).toEqual([]);
  });

  it('accepts known metric codes and page limits through 100 but rejects unknown codes and 101', async () => {
    const accepted = plainToInstance(IntelligenceMetricsQuery, {
      metricCodes: 'SALES_ISSUED,INVENTORY_ON_HAND',
      limit: '100',
    });
    const rejected = plainToInstance(IntelligenceMetricsQuery, {
      metricCodes: 'ARBITRARY_SQL',
      limit: '101',
    });

    expect(await validate(accepted)).toEqual([]);
    expect(invalidProperties(await validate(rejected))).toEqual(expect.arrayContaining(['metricCodes', 'limit']));
  });
});
