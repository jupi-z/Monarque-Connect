# 96 — Phase 9.5 contract proposal

**Status:** contract-first, implementation pending.  
**Baseline:** `main@5c2c56d3433339585407cdf6c95f7fbd3ecc146a`.  
**Scope:** FairScale catalogue, deterministic quotes and establishment-capacity projection only.

## Ownership boundaries

- Platform Billing owns published USD price versions, quote snapshots and commercial identity links.
- Product Entitlements remains the authority for module entitlement and activation.
- Tenancy remains the authority for memberships, establishments and establishment scopes.
- SALES remains the authority for tenant invoices and `PaymentRecord`.
- Phase 9.5 never activates a paid plan and never claims that it accepts payment.

## HTTP surface

All monetary values are integer USD cents.  The server selects the published catalog version; client-provided amounts are not accepted.

| Method | Route | Responsibility |
|---|---|---|
| `GET` | `/api/v1/billing/catalog` | Public published FairScale plans and establishment add-on prices |
| `POST` | `/api/v1/organizations/{organizationId}/billing/quotes` | Tenant-scoped deterministic quote snapshot |
| `GET` | `/api/v1/organizations/{organizationId}/billing/quotes/{quoteId}` | Tenant-scoped quote retrieval |
| `GET` | `/api/v1/organizations/{organizationId}/billing/capacity` | Effective current establishment capacity |
| `POST` | `/api/v1/organizations/{organizationId}/billing/capacity/estimate` | Non-mutating capacity estimate |

Quote and estimate mutations require `Idempotency-Key`. Tenant routes require a membership with the corresponding billing read/write permission and respect establishment scope. A quote is not an invoice, checkout order or entitlement grant.

## Persistent model direction

The implementation adds immutable `PriceVersion`/`PriceComponent` records, a tenant-scoped `BillingCustomer` identity with explicit organization links, durable promotion eligibility/redemption history, and quote snapshots. Existing EUR `PlanVersion` rows and historical subscriptions remain untouched. New catalog versions are additive and seed-replay safe.

The effective establishment capacity is computed as included plan capacity plus consented, paid add-ons and bounded platform overrides. Phase 9.5 only models and estimates add-ons; activation/payment reconciliation belongs to Phase 9.6.

## Non-goals

This contract does not expose checkout, provider webhooks, invoices, refunds, renewals or platform administration. Those endpoints belong to the Phase 9.6 contract and must not be implemented as implicit side effects of these routes.
