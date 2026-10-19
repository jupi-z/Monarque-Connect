# Phase 9.6 Operational Closure Plan

> **Goal:** turn the remaining FairScale V1 production gates into an explicit, fail-closed and auditable release procedure without pretending that external payment, backup or compliance evidence already exists.

**Architecture:** the application remains provider-neutral. A deployment preflight validates the environment and a time-bounded evidence manifest before staging or production billing can be enabled. The manifest contains references to externally verifiable evidence; it never contains payment secrets, card data or personal data.

**Tech stack:** Node.js 24, TypeScript/NestJS, PostgreSQL, existing BillingProvider port, GitHub Actions and versioned Markdown evidence.

**Spec:** [Docs/91](91_PHASE_9_6_FAIRSCALE_BILLING_EXECUTION_SPEC.md), [Docs/92](92_FAIRSCALE_V1_ACCEPTANCE_MATRIX.md), [Docs/93](93_FAIRSCALE_PHASES_STATUS.md).

## Global constraints

- `TEST` is permitted only for `NODE_ENV=test`; it is never a staging or production provider.
- No PAN, CVV, provider secret or webhook secret may be stored in the evidence manifest or emitted by the preflight.
- Production billing remains disabled until every external gate is independently evidenced.
- The preflight is a release guard, not proof that an external provider, mandate, backup or compliance review happened.
- Existing Billing, tenancy, authorization, migration and Outbox invariants remain unchanged.

## Closure gates

The following gates are required for `staging` and `production`:

1. `providerVerified`: a selected non-test provider has a verified account, webhook signature path and sandbox/live separation.
2. `mandateVerified`: the payment authorization/mandate path is operational and its evidence is retained outside the repository.
3. `reconciliationVerified`: a production-like reconciliation run proves provider transactions, BillingPayment, invoices and reversals agree.
4. `observabilityVerified`: logs, metrics, alerts and incident ownership are configured without payment secrets or message contents.
5. `backupRestoreVerified`: a database backup and restore drill completed successfully for the release environment.
6. `complianceVerified`: the responsible reviewer approved the Monarque Group invoice/data treatment for the intended deployment; no legal or tax conclusion is inferred by this document.

The evidence manifest must also include the target environment, provider name, observation timestamp, expiry timestamp and non-sensitive evidence references. Expired or environment-mismatched evidence fails closed.

## Execution tasks

- [x] Define and document the external gate contract.
- [x] Implement a deterministic deployment preflight with non-production bypass limited to local/test environments.
- [x] Add regression tests for fail-closed behavior, placeholder secrets, expired evidence, environment mismatch and complete evidence.
- [x] Add an explicit package command and environment template entries.
- [ ] Select and configure a real payment provider or approve a separately audited manual payment circuit.
- [ ] Execute and retain mandate, reconciliation, observability, backup/restore and compliance evidence for the target environment.
- [ ] Re-run the canonical HTTP scenario and update Docs/92, Docs/93 and Docs/98 with the actual artifacts.
- [ ] Close issue #123 only after the preceding external gates are proven.

## Review focus

- A `TEST` provider must fail in staging/production even when a secret is present.
- Placeholder or short secrets must fail without being printed.
- Missing, expired or environment-mismatched evidence must identify only the missing gate names.
- A complete manifest must pass without exposing its contents in normal output.
- Local/development and test workflows must remain usable without falsely enabling commercial billing.

## Current decision

This plan makes the remaining work executable and prevents accidental commercial activation. It does not close Phase 9.6: the unchecked items are external facts that cannot be manufactured by repository changes.
