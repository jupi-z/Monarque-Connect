export interface BillingPaymentIntent {
  readonly providerPaymentId: string;
  readonly status: 'REQUIRES_ACTION' | 'PROCESSING';
}

export interface VerifiedBillingProviderEvent {
  readonly providerEventId: string;
  readonly eventType: string;
  readonly providerPaymentId: string;
  readonly status: 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | 'CHARGEBACK';
  readonly amountMinor: bigint;
  readonly currency: string;
}

export interface BillingPaymentProviderPort {
  readonly name: string;
  createPaymentIntent(input: { paymentAttemptId: string; amountMinor: bigint; currency: string; }): Promise<BillingPaymentIntent>;
  verifyWebhook(input: { eventId: string; signature: string; payload: Record<string, unknown>; }): VerifiedBillingProviderEvent;
}
