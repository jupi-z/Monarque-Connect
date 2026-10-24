# CI failure forensics and test isolation stabilization

Date: 2026-10-24
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
| [#40127474647](https://github.com/jupi-z/Monarque-Connect/actions/runs/40127474647) | Workflow dispatch, initial stabilization SHA `bb9d9953688b4667dea6c9c0ea45dd482c723218` | Failed before checkout: `actions/setup-node@v4` archive download from `codeload.github.com` timed out three times (100 seconds each) | Complete runner setup log |

The full logs do not include the CRM problem response bodies, the authorization decision projection, the SQL state at failure, or the Prisma constraint metadata for the 409. Those facts cannot be reconstructed from a later successful execution.

## 3. Root-cause findings

### 3.1 CRM 403s and Phase 1 organization 409 in #446

**Status: `ROOT_CAUSE_NOT_PROVEN` for each historical response.** The run proves only the expected/actual statuses and test locations. It does not identify whether each 403 came from membership, role permission, module entitlement, module activation, subscription/plan resolution, or establishment scope. It does not identify whether the 409 was caused by a PostgreSQL unique constraint, an FK, a plan/subscription invariant, a quota, or another conflict.

No authorization or organization business rule was relaxed. The test harness now logs redacted `application/problem+json` fields and a minimal SQL authorization/entitlement snapshot on unexpected CRM/Phase 1 statuses. Test-only authorization logs record the precise denial branch (membership, permission, module plus resolved entitlement, transaction membership, or establishment scope). Organization creation logs only Prisma conflict code and constraint metadata, without values. These diagnostics are limited to `NODE_ENV=test`.

The CRM suite and Phase 1 E2E both pass in isolation repeatedly and in both file orders locally. Therefore a current deterministic failure was not reproduced; this does not prove the exact branch that fired in the old run.

### 3.2 Duplicate E2E execution in #443

**Cause proven:** `npm test` included `tests/e2e/**/*.e2e.test.ts` through the default Vitest include. The reusable workflow then separately invoked `npm run test:e2e`, executing the same E2E cases a second time. The second pass was not an independent validation of a distinct test set and operated against the earlier workflow's database state when the shared-database input was used.

The workflow now has explicit unit, PostgreSQL integration, and HTTP E2E steps. Each test class has a dedicated Vitest config, and E2E runs exactly once against a separately migrated database.

The exact reasons for the two historical HTTP responses in #443 are **`ROOT_CAUSE_NOT_PROVEN`**: the log contains no problem body or snapshot sufficient to select an authorization/entitlement branch.

### 3.3 Intermittent failures and shared TRUNCATE in #439

**Cause proven at the test architecture level:** every test file loaded `tests/setup/reset-test-database.ts`, which truncated all public tables with `CASCADE`. The old run spawned 95 Vitest workers. A controlled local reproduction running GoodsReceipt and Inventory-ledger files concurrently completed assertions but failed teardown with a PostgreSQL FK violation on `warehouses_establishment_id_organization_id_fkey`, because one suite's global reset erased records owned by the other. This demonstrates that the prior global reset plus parallel file workers did not provide isolation.

The exact authorization branch behind the old #439 `403` observations remains **`ROOT_CAUSE_NOT_PROVEN`**. The reset race is a demonstrated interfering mechanism and strong explanatory factor, but the old log lacks a branch snapshot to prove that it caused each particular 403.

The integration and E2E configurations now serialize files and tests within their database; each CI execution owns a unique PostgreSQL container and database, and E2E uses its own freshly migrated database. Unit tests do not load the reset hook and do not require PostgreSQL. Intentional concurrency remains inside the relevant concurrency tests.

## 4. Database and runner isolation

The reusable workflow now creates `monarque-ci-postgres-${{ github.run_id }}-${{ github.run_attempt }}` for every job, asks Docker to allocate a free host port, derives the connection URL from that port, and removes that exact container under `if: always()`. The E2E database is created and migrated separately within that per-run container. The prior externally supplied database URL/host/port path was removed because it allowed jobs and the repeated E2E step to share state and bypassed the local-test database guard.

The self-hosted runner skips both the npm cache and `setup-node`: its previous large cache restore timed out, and run [#40127474647](https://github.com/jupi-z/Monarque-Connect/actions/runs/40127474647) failed before checkout because downloading `actions/setup-node@v4` from `codeload.github.com` timed out three times (100 seconds each). A step-level `if` does not prevent the Actions runner from downloading an action archive during job preparation. Therefore CI now has separate self-hosted and GitHub-hosted reusable workflow wrappers. The self-hosted workflow does not reference `setup-node` at all and verifies the installed Node.js major version locally; the hosted fork workflow retains `setup-node` and npm caching. The runners currently have Node.js 24.22.0/npm 11.19.1. Runner labels preserve the isolated PR runner for same-repository PR code and the primary runner for trusted dispatch/main validation. No persistent database or shared container is used by the workflow.

The local mirror `scripts/ci-local.ps1` was also changed to launch a uniquely named disposable PostgreSQL container on an OS-assigned port and remove only that container in `finally`. It no longer uses `docker compose down`, drops a fixed-name test database, or stops the developer's shared Compose PostgreSQL service. Its `npm test` step is the sole test invocation; E2E is not repeated.

Unique run/attempt resource names and dynamic ports permit concurrent jobs without a shared-container name or fixed-port collision. Actual overlapping GitHub workflow execution still must be observed after this branch is pushed; it is a required outstanding gate.

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
| CRM alone, 10 independent fresh-reset runs | 10/10 passed; logs `crm-01.log` … `crm-10.log` under `%TEMP%\monarque-ci-forensics-20261024\repeat-targets` |
| Phase 1 E2E alone, 10 independent fresh-reset runs | 10/10 passed; logs `phase1-01.log` … `phase1-10.log` |
| CRM then Phase 1, one worker | 7/7 passed |
| Phase 1 then CRM, one worker | 7/7 passed |
| CRM + Inventory/GoodsReceipt deliberately parallel against the same DB (before serial boundary) | Reproduced FK failure in suite teardown after concurrent global truncations; demonstrates reset race |
| Integration suite shuffled with seed `20261024` | 43 files, 183 tests passed |
| E2E suite shuffled with seed `20261024` | 10 files, 23 tests passed |
| Full canonical `npm test` | Unit 42 files/167 tests; integration 43 files/183 tests; E2E 10 files/23 tests; total 373 passed |
| E2E repeated on separate freshly migrated database | 10 files, 23 tests passed |
| Migrations from empty and supported historical states | Phase proof scripts for 2, 3, 5, 6, 7, 8, 9, 9.5, 9.6 and 10A passed; logs under `%TEMP%\monarque-ci-forensics-20261024\migration-proofs` |
| Prisma, OpenAPI, contracts, lint, typecheck, build | Passed locally: 200 OpenAPI operations; Prisma validate; contract schema/examples; lint, typecheck and build exit 0 |
| Two overlapping GitHub CI workflows on this final SHA | **Pending** |
| Three consecutive full GitHub CI runs on one final SHA | **Pending** |

The final canonical `npm test` run passed 42 unit files/167 tests, 43 integration files/183 tests, and 10 E2E files/23 tests. After the final test-only diagnostic redaction hardening, CRM passed 5/5 and Phase 1 HTTP E2E passed 2/2; lint, typecheck, build, workflow YAML parsing, PowerShell parsing, and `git diff --check` also passed. Migration proofs were rerun during this investigation and passed for each listed phase; no migration file is changed by this branch.

## 7. Modifications and rationale

The changes are confined to workflow orchestration, the local CI mirror, test scripts/configurations, test fixtures, test-only diagnostics, and this report. The modifications eliminate redundant E2E invocation, separate unit/integration/E2E responsibilities, prevent concurrent global resets, give every CI attempt unique database resources, retain cleanup on failure/cancellation, and make unexpected HTTP failures capture enough redacted state for future exact diagnosis.

No business authorization, entitlement, quota, tenancy rule, migration, or historical contract was changed. The only production-source edits add diagnostics guarded by `NODE_ENV === 'test'`; their execution path in other environments is inert.

## 8. Residual issues and required gates

1. Exact root branches for the five historical #446 responses and the two #443 HTTP failures remain `ROOT_CAUSE_NOT_PROVEN`; future failures will now emit the missing diagnostics.
2. The controlled race proves that shared global truncation and parallel files can interfere. CI now prevents this through serialization and per-run databases. A future redesign to per-suite schemas is not justified unless serial runtime becomes unacceptable.
3. A non-failing `pg` deprecation warning is reproducible in a Messaging concurrency test while Prisma runs concurrent queries inside an interactive transaction. The test passes and the warning has not been shown to cause instability; it is recorded as a maintenance residual.
4. Required final evidence remains pending: PR CI, three full successful workflow_dispatch runs for one immutable final SHA, overlapping workflow resource isolation, and cleanup confirmation. Do not merge until all are verified.

## 9. Acceptance decision

**NO-GO for closure and merge at this stage.** Local regression evidence supports the new separation and fixture ownership, but GitHub final-SHA repetition/concurrency gates are outstanding and historical HTTP decision branches remain unproven. If those old branch-level causes are treated as mandatory evidence for closure, the mission must remain open even after green CI; the new diagnostics can prove future reproductions but cannot retroactively reconstruct missing database state.

The final review should verify the PR diff, CI run SHA for each execution, complete job conclusions, per-run container cleanup, and that no Phase 10A.5 implementation or migration entered the branch.

## 10. References

- [PR #156](https://github.com/jupi-z/Monarque-Connect/pull/156)
- [Incident run #439](https://github.com/jupi-z/Monarque-Connect/actions/runs/40092635128)
- [Incident run #443](https://github.com/jupi-z/Monarque-Connect/actions/runs/40109257225)
- [Incident run #446](https://github.com/jupi-z/Monarque-Connect/actions/runs/40116083980)
- [Backend CI workflow](../.github/workflows/backend-ci.yml)
- [Reusable backend CI workflow](../.github/workflows/backend-ci-reusable.yml)
- [Hosted runner workflow](../.github/workflows/backend-ci-hosted-reusable.yml)
- [Shared validation action](../.github/actions/backend-ci-validation/action.yml)
