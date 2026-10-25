# CI failure forensics and test isolation stabilization

Date: 2026-10-25
Repository: `jupi-z/Monarque-Connect`
Work branch: `monarque/ci-runner-e2e-isolation-fix`
Base observed before changes: `65f151bcd4eb9ea5add5764f23615679a9faddce`

## 1. Scope and verdict

This change is limited to CI orchestration, test execution boundaries, deterministic test fixtures, and test-only diagnostics. No Phase 10A.5 feature or migration is included. Historical migrations and production authorization, entitlement, organization, CRM, and inventory decisions are unchanged.

**Current verdict: NO-GO for declaring CI stabilization complete or merging.** Local validation is extensive, but the exact historical HTTP decision branches from runs #446 and #443 cannot be recovered from their retained logs, and the required three full GitHub runs against one final SHA plus overlapping workflow validation have not yet been observed. The branch may be pushed for CI evidence, but it must remain unmerged until those gates are satisfied or explicitly reported as unavailable.

## 2. Incident chronology and source evidence

| Run | PR / SHA | Observed result | Evidence |
|---|---|---|---|
| [#439](https://github.com/jupi-z/Monarque-Connect/actions/runs/40092635128), attempt 1 | PR #155, `f30354dee7de49987195bf7f232600d64f42c7fb` | Intermittent integration failures; runner log shows 95 Vitest workers and a suite-wide reset in every file | Downloaded complete job log, locally preserved with this investigation |
| [#439](https://github.com/jupi-z/Monarque-Connect/actions/runs/40092635128), attempt 2 | Same PR/head | Success after rerun | GitHub run attempt and job conclusion |
| [#443](https://github.com/jupi-z/Monarque-Connect/actions/runs/40109257225), attempt 2 | PR #152, `3da05fd41aca61ac8bdc04d970803fe0b873577e` | `npm test` passed 373 tests; a subsequent standalone E2E step repeated E2E and failed 2 of 23 | Downloaded complete job log |
| [#446](https://github.com/jupi-z/Monarque-Connect/actions/runs/40116083980) | PR #156, `65f151bcd4eb9ea5add5764f23615679a9faddce` | Five failures: four CRM 403 responses and one Phase 1 organization-create 409 | Downloaded complete job log |
| [#40133503080](https://github.com/jupi-z/Monarque-Connect/actions/runs/40133503080) | PR #156, head `a38877583f688932a5ba59fe040725fc9fc3e19d` | Hosted full validation passed; PR checkout used merge ref `c072e16525a8bd4eb3e23512d2371cf51f73ad11` | Complete hosted job log |
| [#40133570030](https://github.com/jupi-z/Monarque-Connect/actions/runs/40133570030) | Dispatch, exact SHA `a38877583f688932a5ba59fe040725fc9fc3e19d` | Integration suite failed 4 Cash tests; 179/183 integration tests passed; E2E/build were skipped after the failure | Complete self-hosted job log |
| Local full run after subscription fixture fixes | Worktree diff based on `a388775…` | Unit 167/167 passed; integration 180/183 passed; 3 seed/catalog tests exceeded Vitest's implicit 5 s timeout | Captured `npm test` log under `%TEMP%\monarque-ci-full-26352` |
| Local diagnostic run for affected seed tests | Same code before timeout correction | FairScale catalog and entitlements files passed 7/7 with explicit 60 s diagnostic timeout | Complete targeted Vitest log under `%TEMP%\monarque-ci-seed-diagnosis-18336` |
| [#40127474647](https://github.com/jupi-z/Monarque-Connect/actions/runs/40127474647) | Workflow dispatch, initial stabilization SHA `bb9d9953688b4667dea6c9c0ea45dd482c723218` | Failed before checkout: `actions/setup-node@v4` archive download from `codeload.github.com` timed out three times (100 seconds each) | Complete runner setup log |

The full logs do not include the CRM problem response bodies, the authorization decision projection, the SQL state at failure, or the Prisma constraint metadata for the 409. Those facts cannot be reconstructed from a later successful execution.

## 3. Root-cause findings

### 3.1 CRM 403s and Phase 1 organization 409 in #446

**Status: `ROOT_CAUSE_NOT_PROVEN` for each historical response.** The run proves only the expected/actual statuses and test locations. It does not identify whether each 403 came from membership, role permission, module entitlement, module activation, subscription/plan resolution, or establishment scope. It does not identify whether the 409 was caused by a PostgreSQL unique constraint, an FK, a plan/subscription invariant, a quota, or another conflict.

No authorization or organization business rule was relaxed. The test harness now logs redacted `application/problem+json` fields and a minimal SQL authorization/entitlement snapshot on unexpected CRM/Phase 1 statuses. Test-only authorization logs record the precise denial branch (membership, permission, module plus resolved entitlement, transaction membership, or establishment scope). Organization creation logs only Prisma conflict code and constraint metadata, without values. These diagnostics are limited to `NODE_ENV=test`.

The CRM suite and Phase 1 E2E both pass in isolation repeatedly and in both file orders locally. Therefore a current deterministic failure was not reproduced; this does not prove the exact branch that fired in the old run.

### 3.2 Failures in the second E2E pass of #443

The complete run log provides more detail than the prior summary. In the second E2E invocation, the Phase 1 test received capability reason `SUBSCRIPTION_INACTIVE` where it expected `MODULE_DEACTIVATED` after disabling CATALOG. This proves the effective-subscription gate had already denied the module before activation state was considered; the old log has no `evaluatedAt`, subscription row, plan projection, or database snapshot to establish why the subscription was not effective. Its underlying state cause remains `ROOT_CAUSE_NOT_PROVEN`.

The other failure was `GET /api/v1/organizations/{organizationId}/inventory/balances?...` in `tests/e2e/phase7-operations.e2e.test.ts`, expected 200 and received 403. That test passed during the E2E pass inside `npm test` and failed during the immediately following duplicate E2E pass. The logs contain no authorization branch, problem body, or SQL snapshot for that 403; its precise cause remains `ROOT_CAUSE_NOT_PROVEN`.

The workflow defect is proven separately: both invocations selected `tests/e2e/**/*.e2e.test.ts`, so the second pass duplicated the suite against the same workflow database resource. The workflow now has disjoint unit/integration/E2E commands and provisions a separately migrated database for the single E2E pass. This removes the duplicate execution and shared-state exposure, but it cannot retroactively prove the missing 403 branch or subscription state.

### 3.3 Cash 403s in run #40133570030

**Cause proven for this new run:** all four failures reached `AuthorizationService.requireModule` from `CashAccountService.create`. The test-only decision projection records `moduleCode=CASH`, `reason=SUBSCRIPTION_INACTIVE`, `entitled=false`, and no resolved plan/subscription. Its SQL snapshot independently records an ACTIVE organization, an ACTIVE subscription, and an ACTIVE BUSINESS v1 plan. In `SubscriptionService.resolveEffective`, the remaining time eligibility predicate is `startsAt <= evaluatedAt`. The subscription fixture's start was created with `new Date()` immediately before the requests, placing it at the evaluation boundary. The denial log's timestamp and database-write timestamp are separate observations and do not, by themselves, prove the resolver's exact comparison instant; the resolver projection did not yet record `evaluatedAt` in that run.

The Cash, Expenses, Inventory-ledger, and GoodsReceipt-to-Inventory tests created active subscriptions with `startsAt: new Date()` immediately before exercising the services. That makes entitlement fixtures depend on the wall-clock boundary. The production resolver correctly refuses a subscription before its effective start. These fixtures now use the deterministic past date `2020-01-01T00:00:00.000Z`; the test-only authorization diagnostic also records the projection's exact `evaluatedAt` for future reproductions. No entitlement rule or production decision was relaxed. Ten targeted Cash integration invocations passed after the Cash fixture correction; the other three suites still require reruns after their fixture edits.

This does not retroactively identify the missing authorization/constraint branches in #446 or #443. Those remain `ROOT_CAUSE_NOT_PROVEN`.

### 3.4 Local npm timeout mismatch

The first local full-suite rerun used bare `npm test`, which did not inherit the GitHub workflow's explicit `--testTimeout=30000`. Vitest therefore used its 5 s default and three seed-backed integration tests plus the long HTTP Messaging flow timed out at approximately 5.0–5.2 s. The same FairScale/entitlements files passed 7/7 with the workflow's 30 s timeout. The GitHub workflow has consistently passed `--testTimeout=30000` to each test group, including in historical #443 logs.

The unit, integration, and E2E Vitest configs now set `testTimeout: 30000`, matching the existing CI command-line limit while retaining a finite test deadline. The special 60 s allowances added during diagnosis were removed, except timeouts that were already part of the baseline. The default package scripts now behave consistently with CI when run locally.

### 3.5 Intermittent failures and shared TRUNCATE in #439

**Cause proven at the test architecture level:** every test file loaded `tests/setup/reset-test-database.ts`, which truncated all public tables with `CASCADE`. The old run spawned 95 Vitest workers. A controlled local reproduction running GoodsReceipt and Inventory-ledger files concurrently completed assertions but failed teardown with a PostgreSQL FK violation on `warehouses_establishment_id_organization_id_fkey`, because one suite's global reset erased records owned by the other. This demonstrates that the prior global reset plus parallel file workers did not provide isolation.

The exact authorization branch behind the old #439 `403` observations remains **`ROOT_CAUSE_NOT_PROVEN`**. The reset race is a demonstrated interfering mechanism and strong explanatory factor, but the old log lacks a branch snapshot to prove that it caused each particular 403.

The integration and E2E configurations now serialize files and tests within their database; each CI execution owns a unique PostgreSQL container and database, and E2E uses its own freshly migrated database. Unit tests do not load the reset hook and do not require PostgreSQL. Intentional concurrency remains inside the relevant concurrency tests.

## 4. Database and runner isolation

The reusable workflow now creates `monarque-ci-postgres-${{ github.run_id }}-${{ github.run_attempt }}` for every job, asks Docker to allocate a free host port, derives the connection URL from that port, and removes that exact container under `if: always()`. The E2E database is created and migrated separately within that per-run container. The prior externally supplied database URL/host/port path was removed because it allowed jobs and the repeated E2E step to share state and bypassed the local-test database guard.

The self-hosted runner skips both the npm cache and `setup-node`: its previous large cache restore timed out, and run [#40127474647](https://github.com/jupi-z/Monarque-Connect/actions/runs/40127474647) failed before checkout because downloading `actions/setup-node@v4` from `codeload.github.com` timed out three times (100 seconds each). A step-level `if` does not prevent the Actions runner from downloading an action archive during job preparation. Therefore CI now has separate self-hosted and GitHub-hosted reusable workflow wrappers. The self-hosted workflow does not reference `setup-node` at all and verifies the installed Node.js major version locally; PR workflows use an ephemeral GitHub-hosted runner with `setup-node`, and trusted dispatch/main validation stays on the primary self-hosted runner. The isolated PR runner was observed offline with its service active and an assigned job stalled, so it is no longer selected for PR code. No persistent database or shared container is used by the workflow.

The local mirror `scripts/ci-local.ps1` launches a uniquely named disposable PostgreSQL container on an OS-assigned port and removes only that container in `finally`. It no longer uses `docker compose down`, drops a fixed-name test database, or stops the developer's shared Compose PostgreSQL service. It now follows CI's three explicit test groups and creates/migrates a separate E2E database before the single E2E pass.

Unique run/attempt resource names and dynamic ports permit concurrent jobs without a shared-container name or fixed-port collision. A concurrent PR validation and workflow dispatch were observed for head SHA `a38877583f688932a5ba59fe040725fc9fc3e19d`: hosted PR run [#40133503080](https://github.com/jupi-z/Monarque-Connect/actions/runs/40133503080) and self-hosted dispatch [#40133570030](https://github.com/jupi-z/Monarque-Connect/actions/runs/40133570030) overlapped and used separate runner environments. Their PostgreSQL resources were named `monarque-ci-postgres-40133503080-1` and `monarque-ci-postgres-40133570030-1`; the self-hosted container used dynamic port `65124` and was removed by the failure cleanup. The hosted full validation passed; the exact-SHA dispatch failed on the Cash fixture described above. This proves resource separation and cleanup on failure, but not successful full validation under concurrent workflows. A fresh overlap test remains required for the final SHA.

## 5. Test ownership and repeatability changes

- `test:unit`: database-free files only, no database reset hook.
- `test:integration`: Prisma/PostgreSQL integration and persistence files, one worker, suite-owned fixtures, reset hook between files.
- `test:e2e`: HTTP E2E files only, one worker, separately prepared test database.
- `npm test`: runs those three groups once in order; no duplicate E2E pass.
- Fixed global assumptions in Cash, Inventory, Network, CRM, Purchases, Referentials, Sales and E2E fixtures. Tests now assert their own records rather than relying on a previous test's rows, generated sequence values, global counts, or shared IDs.

The reset hook remains a whole-database reset, but it is now bounded to serial integration/E2E execution on a database owned by one workflow job. It is never loaded by unit tests. Running database suites concurrently against the same URL remains unsupported by design; CI uses distinct per-run databases. Targeted concurrency tests continue to use concurrent requests inside one test and are not serialized internally.

## 6. Reproduction matrix and local evidence

Local environment: Node 24.21.0, npm 11.19.0, Prisma 7.10.0, PostgreSQL 17, Docker Desktop 29.8.2. The ephemeral local container was `monarque-forensic-local-20261024`; its test and E2E databases were migrated independently. No production database was used.

| Scenario | Evidence/result |
|---|---|
| CRM alone, 10 independent fresh-reset runs on current diff | 10/10 passed, 5 tests each; logs `crm-01.log` … `crm-10.log` under `%TEMP%\monarque-ci-repeat-16760` |
| Phase 1 E2E alone, 10 independent fresh-reset runs on current diff | 10/10 passed, 2 tests each; logs `phase1-01.log` … `phase1-10.log` under `%TEMP%\monarque-ci-repeat-16760` |
| CRM then Phase 1, one worker on current diff | Both files passed: CRM 5/5 then Phase 1 2/2, same migrated disposable database with reset hook between files; logs under `%TEMP%\monarque-ci-order-check-6100` |
| Phase 1 then CRM, one worker on current diff | Both files passed: Phase 1 2/2 then CRM 5/5, same migrated disposable database with reset hook between files; logs under `%TEMP%\monarque-ci-order-check-6100` |
| CRM + Inventory/GoodsReceipt deliberately parallel against the same DB (before serial boundary) | Reproduced FK failure in suite teardown after concurrent global truncations; demonstrates reset race |
| Integration suite shuffled with seed `20261024` | 43 files, 183 tests passed |
| Cash integration after deterministic subscription-start fixture | 10 separate invocations, 7/7 tests each; each invocation ran the suite reset hook on a disposable PostgreSQL database |
| Expenses, Inventory-ledger, and GoodsReceipt subscription-start fixtures | Changed to the same deterministic past timestamp after the exact-SHA CI Cash failure; reruns pending |
| E2E suite shuffled with seed `20261024` | 10 files, 23 tests passed |
| Full canonical `npm test` before Vitest configs matched workflow timeout | Unit 42 files/167 tests passed; integration 41/43 files, 180/183 tests passed; three seed-backed tests timed out at 5 s; E2E was not reached |
| Final local CI-equivalent sequence after timeout alignment and reset consolidation | Unit 42 files/167 tests; integration 43 files/183 tests; E2E 10 files/23 tests all passed | Logs `%TEMP%\monarque-ci-final-local-392`; integration 627.66 s, E2E 185.59 s |
| Unit suite with `DATABASE_URL` and `TEST_DATABASE_URL` unset | Initial probe exposed one accidental `EventDatabase` config dependency; after overriding that external provider in the module-injection test, all 42 files/167 tests passed with no database URL and no PostgreSQL service |
| Integration/E2E database reset | Whole public test schema reset by one dynamically generated `TRUNCATE ... RESTART IDENTITY CASCADE`; Prisma migration history preserved | Included in the final local sequence above |
| Targeted FairScale/entitlements files with workflow's 30 s timeout | 2 files, 7/7 tests passed; diagnostic logs under `%TEMP%\monarque-ci-seed-diagnosis-18336` |
| Targeted FairScale/entitlements files after config alignment | 2 files, 7/7 tests passed; logs under `%TEMP%\monarque-ci-seed-verify-23780` |
| Full canonical test groups after Vitest timeout alignment | Unit 42 files/167 tests, integration 43 files/183 tests, and E2E 10 files/23 tests passed on current worktree | `%TEMP%\monarque-ci-final-local-392` |
| E2E on separate freshly migrated database | 10 files, 23 tests passed; 185.59 s | `%TEMP%\monarque-ci-final-local-392\e2e.log` |
| Migrations from empty and supported historical states | Final rerun passed for 2, 3, 5, 6, 7, 8, 9, 9.5, 9.6 and 10A against disposable PostgreSQL 17; 54 migrations on current head; all phase upgrade assertions passed |
| Prisma schema, OpenAPI, contracts, lint, typecheck, build | Final local checks passed: Prisma schema valid; 200 OpenAPI operations; contract schemas/examples valid; lint, typecheck and build exit 0 |
| Runtime dependency audit | Passed: 137 production-reachable packages; no high/critical advisory reachable at runtime. Four high advisories are limited to development/tooling packages and were reported as non-runtime by the repository checker |
| Two overlapping GitHub CI workflows on this final SHA | **Pending** |
| Three consecutive full GitHub CI runs on one final SHA | **Pending** |

The canonical `npm test` run before timeout alignment passed all unit tests, then 180/183 integration tests, but used bare Vitest defaults of 5 s rather than the workflow's 30 s; E2E was not reached in that attempt. The configs now default to the same 30 s limit. On the current worktree, the final CI-equivalent sequence passed unit 167/167, integration 183/183, and isolated E2E 23/23, with E2E on a separately migrated database; logs are under `%TEMP%\monarque-ci-final-local-392`. The integration run took 627.66 s on this Windows/Docker host; test execution accounted for 82% and Vitest import for 15%, so serial execution has a noticeable local runtime. A previous diagnostic run was stopped after 12 minutes before a summary; during that attempt, a read-only diagnostic query against application tables collided with a global truncate, and PostgreSQL aborted the diagnostic query as a deadlock victim. This was instrumentation interference, not a test assertion failure. The reset hook now performs the same reset as one atomic `TRUNCATE` statement, excluding `_prisma_migrations`; no claim is made that this consolidation explains the full suite runtime. Separately, the exact-SHA self-hosted run #40133570030 exposed four Cash fixture failures; after fixture correction, Cash passed 10/10 local invocations (7 tests each), and CRM plus Phase 1 passed 10/10 independent invocations each (50 CRM assertions and 20 Phase 1 assertions). Logs are under `%TEMP%\monarque-ci-repeat-16760`. Both combined orders passed on a migrated disposable database: CRM 5/5 followed by Phase 1 2/2, and the reverse. The current-worktree migration proof rerun passed all nine configured gates (Phase 2, 3, 5, 6, 7, 8, 9 plus 9.5, 9.6, and 10A) against disposable PostgreSQL, without changing migration files.

## 7. Modifications and rationale

The changes are confined to workflow orchestration, the local CI mirror, test scripts/configurations, test fixtures, test-only diagnostics, and this report. The modifications eliminate redundant E2E invocation, separate unit/integration/E2E responsibilities, prevent concurrent global resets, give every CI attempt unique database resources, retain cleanup on failure/cancellation, make unexpected HTTP failures capture enough redacted state for future exact diagnosis, replace just-in-time subscription starts in Cash, Expenses, and Inventory-related fixtures with a deterministic past date, and align Vitest's default test timeout with the existing 30 s CI setting. The Intelligence module metadata test now replaces `EventDatabase` with a test double, so the database-free unit group does not require database configuration or service infrastructure.

No business authorization, entitlement, quota, tenancy rule, migration, or historical contract was changed. The only production-source edits add diagnostics guarded by `NODE_ENV === 'test'`; their execution path in other environments is inert.

## 8. Residual issues and required gates

1. Exact root branches for the five historical #446 responses and the two #443 HTTP failures remain `ROOT_CAUSE_NOT_PROVEN`; those old runs lack the information needed to reconstruct their database/auth state. Future failures now emit the missing diagnostics. The four Cash 403s in #40133570030 are explained by the active subscription's `startsAt: new Date()` fixture combined with `SUBSCRIPTION_INACTIVE`; the precise evaluated-at comparison instant is not captured in that run, so the timing-boundary mechanism is a strongly supported cause rather than a fully timestamp-proven comparison. The fixture and diagnostic have been corrected for future exact evidence.
2. The controlled race proves that shared global truncation and parallel files can interfere. CI now prevents this through serialization and per-run databases. A future redesign to per-suite schemas is not justified unless serial runtime becomes unacceptable.
3. A non-failing `pg` deprecation warning is reproducible in a Messaging concurrency test while Prisma runs concurrent queries inside an interactive transaction. The test passes and the warning has not been shown to cause instability; it is recorded as a maintenance residual.
4. Required final evidence remains pending: green PR CI after the latest test-harness changes, three full successful workflow_dispatch runs for one immutable final SHA, successful overlapping workflow validation on the final wrappers, and cleanup confirmation. Local CI-equivalent tests, migration proofs, Prisma/OpenAPI/contracts, runtime audit, lint, typecheck, and build have now passed; do not merge until the GitHub gates are also verified.

## 9. Acceptance decision

**NO-GO for closure and merge at this stage.** Local regression evidence supports the new separation and fixture ownership, but GitHub final-SHA repetition/concurrency gates are outstanding and historical HTTP decision branches remain unproven. If those old branch-level causes are treated as mandatory evidence for closure, the mission must remain open even after green CI; the new diagnostics can prove future reproductions but cannot retroactively reconstruct missing database state.

The final review should verify the PR diff, CI run SHA for each execution, complete job conclusions, per-run container cleanup, and that no Phase 10A.5 implementation or migration entered the branch.

## 10. References

- [PR #156](https://github.com/jupi-z/Monarque-Connect/pull/156)
- [Incident run #439](https://github.com/jupi-z/Monarque-Connect/actions/runs/40092635128)
- [Incident run #443](https://github.com/jupi-z/Monarque-Connect/actions/runs/40109257225)
- [Incident run #446](https://github.com/jupi-z/Monarque-Connect/actions/runs/40116083980)
- [Hosted PR validation #40133503080](https://github.com/jupi-z/Monarque-Connect/actions/runs/40133503080)
- [Self-hosted full validation #40133570030](https://github.com/jupi-z/Monarque-Connect/actions/runs/40133570030)
- [Backend CI workflow](../.github/workflows/backend-ci.yml)
- [Reusable backend CI workflow](../.github/workflows/backend-ci-reusable.yml)
- [Hosted runner workflow](../.github/workflows/backend-ci-hosted-reusable.yml)
- [Shared validation action](../.github/actions/backend-ci-validation/action.yml)
