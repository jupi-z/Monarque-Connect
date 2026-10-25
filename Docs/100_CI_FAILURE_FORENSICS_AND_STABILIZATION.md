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
| [#40146839715](https://github.com/jupi-z/Monarque-Connect/actions/runs/40146839715) | PR #156, exact head `b86edfb5a3e69652ee0718a9943778559b06bfc1` | Hosted `validate-pr / validate` succeeded | GitHub job conclusion |
| [#40146857214](https://github.com/jupi-z/Monarque-Connect/actions/runs/40146857214) | Workflow dispatch, exact SHA `b86edfb5a3e69652ee0718a9943778559b06bfc1` | Self-hosted job failed before checkout/test initialization; runner resumed after its job credential expired | GitHub check annotation, runner worker log, Windows power events |
| [#40175781205](https://github.com/jupi-z/Monarque-Connect/actions/runs/40175781205) | PR #156, exact head `750efaa00f467b9f93cc7315592f98bb933f0ca4` | Hosted full validation passed; overlapped with dispatch #40175831038 | GitHub job conclusion |
| [#40175831038](https://github.com/jupi-z/Monarque-Connect/actions/runs/40175831038) | Workflow dispatch, exact SHA `750efaa00f467b9f93cc7315592f98bb933f0ca4` | Full self-hosted validation passed: 167 unit, 183 integration, 23 E2E; migration proofs and smoke passed; cleanup succeeded | Complete job log and cleanup step |
| [#40176645418](https://github.com/jupi-z/Monarque-Connect/actions/runs/40176645418) | PR #156, exact head `84013cc473590c2613a3d362fa7f8949d7c96084` | Hosted full validation passed; overlapped with dispatch #40176660085 | GitHub job conclusion |
| [#40176660085](https://github.com/jupi-z/Monarque-Connect/actions/runs/40176660085) | Workflow dispatch, exact SHA `84013cc473590c2613a3d362fa7f8949d7c96084` | Full self-hosted validation passed: 167 unit, 183 integration, 23 E2E; all migration proofs passed; isolated PostgreSQL cleanup succeeded | Complete job log and cleanup step |
| [#40177271229](https://github.com/jupi-z/Monarque-Connect/actions/runs/40177271229) | Workflow dispatch, exact SHA `84013cc473590c2613a3d362fa7f8949d7c96084` | Cancelled while at critical battery; Windows entered battery-triggered sleep during validation; job and cleanup completed, isolated container absent | GitHub job conclusion, Windows power events, battery/power status |
| [#40177912789](https://github.com/jupi-z/Monarque-Connect/actions/runs/40177912789) | Workflow dispatch, exact SHA `d5702dd2f9030edd86ad68b6ce98252f3a33e356` | Unit 167/167 passed; integration 177/183 passed; six Warehouses tests failed with 403; isolated PostgreSQL cleanup succeeded | Full GitHub log, redacted HTTP diagnostics and auth decision projections |
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

### 3.6 Warehouse integration 403s in #40177912789

**Cause proven:** all six failed Warehouse assertions were denied by `AuthorizationService.requireModule` for `INVENTORY`, with `reason=SUBSCRIPTION_INACTIVE`. The authorization projection and SQL snapshot show an ACTIVE organization, OWNER membership, ACTIVE BUSINESS v1 plan, but no effective subscription/plan projection. The durable subscription had `startsAt=2026-10-25T08:50:50.113Z`; the first recorded decision was evaluated at `08:50:48.209Z` and all six test denials occurred before that start. The same subscription row was created by organization setup, and this test fixture changed only `planVersionId`, leaving the just-created future `startsAt` untouched. The production temporal rule `startsAt <= evaluatedAt` was correct; this was test fixture nondeterminism, not an authorization or entitlement defect.

The fixture now sets the subscription start to `2020-01-01T00:00:00.000Z` when it assigns BUSINESS v1, matching the other stabilized module integration fixtures. The existing Warehouse integration file, unchanged in assertions, passed 10/10 independent invocations (6/6 tests each) against a fresh disposable PostgreSQL 17 database. The failed GitHub run also passed the full unit suite (167/167); its integration summary was 177/183 with exactly the six Warehouse tests failing. No business source, migration, permission, or assertion was changed.

## 4. Database and runner isolation

The reusable workflow now creates `monarque-ci-postgres-${{ github.run_id }}-${{ github.run_attempt }}` for every job, asks Docker to allocate a free host port, derives the connection URL from that port, and removes that exact container under `if: always()`. The E2E database is created and migrated separately within that per-run container. The prior externally supplied database URL/host/port path was removed because it allowed jobs and the repeated E2E step to share state and bypassed the local-test database guard.

The self-hosted runner skips both the npm cache and `setup-node`: its previous large cache restore timed out, and run [#40127474647](https://github.com/jupi-z/Monarque-Connect/actions/runs/40127474647) failed before checkout because downloading `actions/setup-node@v4` from `codeload.github.com` timed out three times (100 seconds each). A step-level `if` does not prevent the Actions runner from downloading an action archive during job preparation. Therefore CI now has separate self-hosted and GitHub-hosted reusable workflow wrappers. The self-hosted workflow does not reference `setup-node` at all and verifies the installed Node.js major version locally; PR workflows use an ephemeral GitHub-hosted runner with `setup-node`, and trusted dispatch/main validation stays on the primary self-hosted runner. The isolated PR runner was observed offline with its service active and an assigned job stalled, so it is no longer selected for PR code. No persistent database or shared container is used by the workflow.

### Self-hosted runner interruption in #40146857214 — cause proven

Run [#40146857214](https://github.com/jupi-z/Monarque-Connect/actions/runs/40146857214) targeted exact SHA `b86edfb5a3e69652ee0718a9943778559b06bfc1`. GitHub started `validate-main / validate` at `2026-10-25T00:29:03Z` and marked it failed at `00:39:04Z`. The Windows System log independently records entry into Modern Standby at `00:29:10Z` and wake at `08:07:09Z`; Power-Troubleshooter Event 1 gives the same UTC sleep and wake timestamps. The runner's `Worker_20261025-002907-utc.log` starts the job at `00:29:10Z`, then records attempts to initialize the job at `08:07:13Z`, when GitHub's Results Receiver, action resolver, and WebSocket return HTTP 401. GitHub's check annotation says the self-hosted runner lost communication. The host's resume time and the runner's 401s align with the expired job authorization.

**Root cause proven:** the Windows host entered Modern Standby seconds after the job started and remained asleep beyond GitHub's job lifetime. The WSL runner could not execute or heartbeat during that interval; on wake it resumed with expired job credentials. This was not a test failure, PostgreSQL failure, OOM, or demonstrated CI resource exhaustion. The job failed before checkout and before provisioning its PostgreSQL container, so no workflow container or test process was left behind by this particular run. The run proves a real overlap between hosted PR validation #40146839715 and self-hosted dispatch #40146857214, but because the dispatch runner slept, it does not prove a successful full-suite overlap.

For subsequent validation, the host was held awake only for the duration of the explicitly launched workflow, using a temporary process-scoped Windows execution-state request released in `finally`. No persistent power plan or sleep configuration was changed. The dispatch succeeded, and the separate hosted PR validation succeeded while it was running. Their real overlap on one exact SHA is demonstrated. Three consecutive dispatches on one immutable final SHA remain required.

The first repeated dispatch, [#40176660085](https://github.com/jupi-z/Monarque-Connect/actions/runs/40176660085), succeeded on SHA `84013cc473590c2613a3d362fa7f8949d7c96084`. Its following dispatch, [#40177271229](https://github.com/jupi-z/Monarque-Connect/actions/runs/40177271229), was explicitly cancelled after Windows battery status fell to 4% and System Event 42 recorded a battery-triggered sleep at `2026-10-25T08:40:04Z`; Power-Troubleshooter Event 1 recorded wake at `08:40:55Z`. The workflow completed as cancelled, its post-checkout cleanup succeeded, and the unique PostgreSQL container was absent. This run is not counted as a CI failure or success. After the user connected AC power, Windows reported `ACLineStatus=1`, `PowerOnline=True`, `Charging=True`, `Discharging=False`, with 5% charge. The process-scoped sleep request is not treated as protection against critical-battery sleep; final repeats are only run while AC power is verified.

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
| PR validation and self-hosted workflow dispatch overlapped on exact SHA `84013cc473590c2613a3d362fa7f8949d7c96084` | Full PR validation passed; self-hosted dispatch #1 passed while they overlapped; separate run-scoped PostgreSQL containers |
| Three consecutive full GitHub CI runs on one final SHA | **Passed** on `ec7ae7b6c549c261b4a072c7811f2dc3af3d0dc7`: dispatches [#40183320138](https://github.com/jupi-z/Monarque-Connect/actions/runs/40183320138), [#40184028547](https://github.com/jupi-z/Monarque-Connect/actions/runs/40184028547), and [#40184663304](https://github.com/jupi-z/Monarque-Connect/actions/runs/40184663304), all successful and each with verified per-run PostgreSQL cleanup. The hosted PR validation [#40183268627](https://github.com/jupi-z/Monarque-Connect/actions/runs/40183268627) also passed on the same SHA. |
| Concurrent workflow resource isolation | **Passed**: hosted PR validation #40183268627 ran from 10:04:45Z to 10:09:27Z while self-hosted dispatch #40183320138 ran from 10:05:37Z to 10:14:52Z. Their workflow resource suffixes derive from distinct run IDs, and each used a separate runner environment and PostgreSQL resource. |
| Targeted Warehouse integration after fixture correction | 10/10 invocations, each 6/6 tests, on isolated PostgreSQL 17; the original red run #40177912789 proves the regression case |
| CRM and Phase 1 repeated after subscription-fixture correction | CRM integration 10/10 invocations (5/5 each); Phase 1 HTTP E2E 10/10 (2/2 each); Intelligence + Purchases HTTP E2E 10/10 combined (6/6 each), PostgreSQL 17 disposable container, fresh test reset for every file/invocation; logs `%TEMP%\monarque-fixture-repeat-19428` |
| First full local CI mirror on `b51cee149eb7fe60a6cefd7b144cbca9c5042866` | All validation gates passed: lint/typecheck, migration proofs, OpenAPI 200 operations, contracts, runtime audit, unit 167/167, integration 183/183, isolated E2E 23/23, build. However, container `8c588d1a1a920c8d68a61c83cc6afaa1604815d2319a64a5a1c35793b5746a85` remained because the script-scoped `containerStarted` flag was set in the `Invoke-Step` function scope. It was manually removed and verified absent. This run does not count as a cleanup pass. | Fresh `npm run ci:local`; cleanup defect reproduced and fixed in `d94df41` |
| Full local CI mirror after cleanup correction on `d94df41ac717bce5d74915637a5ea6d38dce57fa` | 2026-10-25: npm ci, Prisma generation/validation, lint, typecheck, migration proofs (54 migrations from empty plus supported historical upgrades through 10A), prisma deploy, OpenAPI 200 operations, contracts, runtime audit, unit 167/167, integration 183/183, isolated E2E 23/23 and build all passed. Billing preflight explicitly skipped under `NODE_ENV=test`. The script exited successfully only after its `finally` removed and verified the uniquely named PostgreSQL 17 container; a follow-up `docker ps -a` found no matching local CI or targeted-test container. | Fresh `npm run ci:local` after commit `d94df41` |
| Three same-SHA full GitHub validations and cleanup | On `ec7ae7b6c549c261b4a072c7811f2dc3af3d0dc7`, dispatches #40183320138, #40184028547 and #40184663304 all completed successfully in sequence. Each passed lint, typecheck, Prisma validation, supported migration proofs through Phase 10A (54 migrations), OpenAPI 200, contracts, runtime audit, unit 167/167, integration 183/183, isolated E2E 23/23, build and HTTP smoke. Each `Cleanup isolated PostgreSQL` step succeeded and a direct Docker query confirmed its uniquely named container absent. Hosted PR CI #40183268627 passed and overlapped in time with dispatch #40183320138 on separate hosted/self-hosted runners and distinct run-ID resources. | Direct `gh run view` JSON, complete logs, and post-run Docker inventory |
| Same-SHA dispatch #40179440453 on `0ba3562fe4f95c993285ddc38ad3ab86b704eb5b` | Unit 167/167 and integration 183/183 passed; E2E 17/23 passed, with 6 denials caused by subscription `startsAt` being 1.27–1.54 seconds after authorization evaluation; `requireModule` correctly returned `SUBSCRIPTION_INACTIVE`; [run](https://github.com/jupi-z/Monarque-Connect/actions/runs/40179440453), full log `%TEMP%\monarque-ci-run-40179440453.log` |

The canonical `npm test` run before timeout alignment passed all unit tests, then 180/183 integration tests, but used bare Vitest defaults of 5 s rather than the workflow's 30 s; E2E was not reached in that attempt. The configs now default to the same 30 s limit. On the current worktree, the final CI-equivalent sequence passed unit 167/167, integration 183/183, and isolated E2E 23/23, with E2E on a separately migrated database; logs are under `%TEMP%\monarque-ci-final-local-392`. The integration run took 627.66 s on this Windows/Docker host; test execution accounted for 82% and Vitest import for 15%, so serial execution has a noticeable local runtime. A previous diagnostic run was stopped after 12 minutes before a summary; during that attempt, a read-only diagnostic query against application tables collided with a global truncate, and PostgreSQL aborted the diagnostic query as a deadlock victim. This was instrumentation interference, not a test assertion failure. The reset hook now performs the same reset as one atomic `TRUNCATE` statement, excluding `_prisma_migrations`; no claim is made that this consolidation explains the full suite runtime. Separately, the exact-SHA self-hosted run #40133570030 exposed four Cash fixture failures; after fixture correction, Cash passed 10/10 local invocations (7 tests each), and CRM plus Phase 1 passed 10/10 independent invocations each (50 CRM assertions and 20 Phase 1 assertions). Logs are under `%TEMP%\monarque-ci-repeat-16760`. Both combined orders passed on a migrated disposable database: CRM 5/5 followed by Phase 1 2/2, and the reverse. The current-worktree migration proof rerun passed all nine configured gates (Phase 2, 3, 5, 6, 7, 8, 9 plus 9.5, 9.6, and 10A) against disposable PostgreSQL, without changing migration files.

## 7. Modifications and rationale

The changes are confined to workflow orchestration, the local CI mirror, test scripts/configurations, test fixtures, test-only diagnostics, and this report. The modifications eliminate redundant E2E invocation, separate unit/integration/E2E responsibilities, prevent concurrent global resets, give every CI attempt unique database resources, retain cleanup on failure/cancellation, make unexpected HTTP failures capture enough redacted state for future exact diagnosis, replace just-in-time subscription starts throughout plan-promotion fixtures with a deterministic past date, and align Vitest's default test timeout with the existing 30 s CI setting. The Intelligence module metadata test now replaces `EventDatabase` with a test double, so the database-free unit group does not require database configuration or service infrastructure.

No business authorization, entitlement, quota, tenancy rule, migration, or historical contract was changed. The only production-source edits add diagnostics guarded by `NODE_ENV === 'test'`; their execution path in other environments is inert.

## 8. Residual issues and required gates

1. Exact root branches for the five historical #446 responses and the two #443 HTTP failures remain `ROOT_CAUSE_NOT_PROVEN`; those runs contain no Problem Details body, authorization decision snapshot, Prisma constraint metadata, or contemporaneous SQL state, so they cannot support exact retrospective attribution. The #40179440453 recurrence provides exact evidence for the same timing class: four Intelligence and two Purchases E2E requests were denied by `AuthorizationService.requireModule` because `EffectiveEntitlementsService` found no effective subscription at `evaluatedAt`; the database snapshot contained an ACTIVE subscription whose `startsAt` was later than that evaluation instant. The fixtures had updated `planVersionId` but not `startsAt`. The correction now sets a fixed past start on every test-side plan-version override. The #446 CRM denials share this fixture pattern in source, but their exact historical 403 branch remains `ROOT_CAUSE_NOT_PROVEN`. The #446 organization-creation 409 and the #443 Phase 1 capability assertion also remain `ROOT_CAUSE_NOT_PROVEN`: their old output omitted the diagnostics added later. Current repeated Phase 1 tests pass after database isolation changes, proving present behavior but not reconstructing those historical response causes. The #443 failures were a Phase 1 `CATALOG` decision mismatch and a Phase 7 Operations 403; the latter also used an immediate plan-promotion fixture. Do not claim those historical branches fully proven.
2. The controlled race proves that shared global truncation and parallel files can interfere. CI now prevents this through serialization and per-run databases. A future redesign to per-suite schemas is not justified unless serial runtime becomes unacceptable.
3. A non-failing `pg` deprecation warning is reproducible in a Messaging concurrency test while Prisma runs concurrent queries inside an interactive transaction. The test passes and the warning has not been shown to cause instability; it is recorded as a maintenance residual.
4. The final repeated-validation and cleanup gates passed on `ec7ae7b6c549c261b4a072c7811f2dc3af3d0dc7`: dispatches #40183320138, #40184028547 and #40184663304 were three consecutive successful full runs, each with verified PostgreSQL cleanup. PR validation #40183268627 passed and overlapped the first dispatch on separate runners/resources. Earlier failures remain part of the incident record and were not discarded; the final three-run sequence began only after the fixture and cleanup fixes were committed.

## 9. Acceptance decision

**NO-GO for closure and merge under the mission's strict forensic criterion.** The local regression, full validation, three consecutive same-SHA GitHub runs, cleanup, and concurrent hosted/self-hosted resource-isolation gates are now proven. However, exact decision branches for the original #446 403/409 responses and #443 failures remain `ROOT_CAUSE_NOT_PROVEN`: their historical logs did not record the Problem Details bodies, authorization projections, Prisma constraint metadata, or contemporaneous SQL state. The later reproduction proves and fixes the subscription-start fixture timing class, but cannot establish that every historical response had that cause. Keep the PR draft and unmerged until that explicit forensic gap is resolved or the requirement is formally waived by the project owner.

The final review should verify the PR diff, CI run SHA for each execution, complete job conclusions, per-run container cleanup, and that no Phase 10A.5 implementation or migration entered the branch.

## 10. References

- [PR #156](https://github.com/jupi-z/Monarque-Connect/pull/156)
- [Incident run #439](https://github.com/jupi-z/Monarque-Connect/actions/runs/40092635128)
- [Incident run #443](https://github.com/jupi-z/Monarque-Connect/actions/runs/40109257225)
- [Incident run #446](https://github.com/jupi-z/Monarque-Connect/actions/runs/40116083980)
- [Hosted PR validation #40133503080](https://github.com/jupi-z/Monarque-Connect/actions/runs/40133503080)
- [Self-hosted full validation #40133570030](https://github.com/jupi-z/Monarque-Connect/actions/runs/40133570030)
- [Hosted PR validation #40146839715](https://github.com/jupi-z/Monarque-Connect/actions/runs/40146839715)
- [Self-hosted dispatch interrupted by Windows Modern Standby #40146857214](https://github.com/jupi-z/Monarque-Connect/actions/runs/40146857214)
- [Hosted PR validation and successful overlap #40175781205](https://github.com/jupi-z/Monarque-Connect/actions/runs/40175781205)
- [Successful self-hosted full validation #40175831038](https://github.com/jupi-z/Monarque-Connect/actions/runs/40175831038)
- [Hosted PR validation #40176645418](https://github.com/jupi-z/Monarque-Connect/actions/runs/40176645418)
- [Successful self-hosted run and overlap #40176660085](https://github.com/jupi-z/Monarque-Connect/actions/runs/40176660085)
- [Battery-interrupted, safely cancelled run #40177271229](https://github.com/jupi-z/Monarque-Connect/actions/runs/40177271229)
- [Warehouse fixture failure with exact authorization diagnostics #40177912789](https://github.com/jupi-z/Monarque-Connect/actions/runs/40177912789)
- [Same-SHA dispatch exposing future-start E2E fixtures #40179440453](https://github.com/jupi-z/Monarque-Connect/actions/runs/40179440453)
- [Final hosted PR validation #40183268627](https://github.com/jupi-z/Monarque-Connect/actions/runs/40183268627)
- [Final same-SHA dispatch 1/3 #40183320138](https://github.com/jupi-z/Monarque-Connect/actions/runs/40183320138)
- [Final same-SHA dispatch 2/3 #40184028547](https://github.com/jupi-z/Monarque-Connect/actions/runs/40184028547)
- [Final same-SHA dispatch 3/3 #40184663304](https://github.com/jupi-z/Monarque-Connect/actions/runs/40184663304)
- [Backend CI workflow](../.github/workflows/backend-ci.yml)
- [Reusable backend CI workflow](../.github/workflows/backend-ci-reusable.yml)
- [Hosted runner workflow](../.github/workflows/backend-ci-hosted-reusable.yml)
- [Shared validation action](../.github/actions/backend-ci-validation/action.yml)
