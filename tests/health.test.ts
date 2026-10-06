import { describe, expect, it } from 'vitest';
import { HealthController } from '../src/health.controller.js';

describe('HealthController', () => {
  it('reports live', () => {
    expect(new HealthController().live()).toEqual({ status: 'ok' });
  });

  it('reports ready', () => {
    expect(new HealthController().ready()).toEqual({ status: 'ok' });
  });
});
