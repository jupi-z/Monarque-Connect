import { beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { BillingProviderService } from '../../src/billing/billing-provider.service.js';

describe('FairScale Phase 9.6 provider boundary', () => {
  const service = new BillingProviderService(undefined as never, undefined as never);

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.FAIRSCALE_BILLING_WEBHOOK_SECRET = 'phase96-test-secret';
  });

  it('rejects a provider that is not explicitly enabled in the test adapter', async () => {
    await expect(service.receiveWebhook('STRIPE', 'evt-1', 'invalid', {})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not accept a forged webhook signature before touching persistence', async () => {
    const payload = { providerPaymentId: 'test_attempt', amountMinor: 3825, currency: 'USD', status: 'SUCCEEDED' };
    const forged = createHmac('sha256', 'wrong-secret').update(JSON.stringify(payload)).digest('hex');
    await expect(service.receiveWebhook('TEST', 'evt-2', forged, payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
