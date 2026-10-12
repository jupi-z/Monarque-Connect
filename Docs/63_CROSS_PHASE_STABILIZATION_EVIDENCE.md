# 63 — Cross-Phase Stabilization — Regression Evidence

## Scope

This stabilization closes the targeted regressions identified after the Phase 3
referentials delivery. It does not reopen Phase 1, Phase 2, or Phase 3 scope;
it hardens their shared invariants before CRM and Network work begins.

## Corrected invariants

| Area | Invariant | Evidence |
|---|---|---|
| Refresh sessions | Reusing a revoked or replaced refresh token revokes the remaining family and persists its audit/outbox record before the request is rejected. | Identity integration regression test |
| Membership scopes | Updating only role or status preserves existing selected-establishment links. | Identity and tenancy integration regression test |
| User capacity | `MAX_USERS` is a permanent capacity counter: suspending/revoking a member releases one unit and reactivation consumes one unit again. | Identity and tenancy integration regression test; quota ledger/audit path |
| Referential reads | Parties, items, and warehouses exclude inactive records by default; `active=false` remains an explicit administrative view. | Referential integration regression tests |
| Referential status transitions | Concurrent requests can commit at most one state transition and therefore at most one audit/outbox status event. | PostgreSQL concurrency regression tests for parties, items, and warehouses |

## Verification commands

The final evidence must be produced from the stabilization branch/PR and then
repeated on the merged `main` commit:

```text
npm run typecheck
npm run lint
npm run build
npm test
npm run test:e2e
npm run openapi:validate
npm run contracts:validate
npm run prisma:validate
npm run prisma:phase2:migration-proof
npm run prisma:phase3:migration-proof
```

The integration suites use PostgreSQL, including the refresh-session, quota,
membership, and referential concurrency regressions. No local scratch files,
progress ledgers, or generated developer-only artifacts belong in the commit.

## Delivery gate

Phase 4 work starts only after the stabilization PR is reviewed, all required
GitHub Actions checks are green, the PR is squash-merged, and the remote branch
is deleted. The repository must then contain only the protected working branch
policy agreed by the team (`main` at this stage).
