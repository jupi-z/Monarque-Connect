# 78 — Phase 7 Operations — Statut d'exécution

## État actuel

La Phase 7 — Operations est livrée et clôturée à 100 %. L'état technique
ci-dessous est vérifié sur `main@c248f0170a23a1b55b2e0386a5e865d5cc9e96aa`
le 14 octobre 2026, avec la preuve consolidée dans
`Docs/79_PHASE_7_CLOSURE_EVIDENCE.md`.

Le cadrage et le contrat Operations sont intégrés. Les Tasks 2 et 3 — Inventory
ledger, balances et intégration GoodsReceipt — sont livrés et vérifiés. La Task
4 — Expenses est livrée par la PR #93 et vérifiée par les CI PR #250 et
post-merge #251. La Task 5 — Cash est livrée par la PR #97 ; ses preuves
structurelles et HTTP ont été durcies par la PR #99 et vérifiées par les CI PR
#266 et post-merge #267. La PR #101 a ajouté les preuves cross-phase, le
harnais de migration Phase 7, le seed de référence idempotent et la régression
d'autorisation Expenses. La CI PR #272 et la CI post-merge #273 sont vertes.
La phase est maintenant fermée ; la gouvernance de `main` reste soumise à la
politique compensatoire branche dédiée → PR → CI → fusion contrôlée, la
protection native restant indisponible sur le plan GitHub actuel.

Suivi : [issue #84](https://github.com/jupi-z/Monarque-Connect/issues/84).

## Artefacts et tranches

- [x] `Docs/77_PHASE7_OPERATIONS_EXECUTION_SPEC.md` — spécification normative ;
- [x] `Docs/78_PHASE_7_STATUS.md` — statut et gates ;
- [x] `Docs/superpowers/plans/2026-10-14-phase-7-operations-plan.md` — plan séquencé ;
- [x] contrat OpenAPI et autorisations centrales — PR #86 ;
- [x] modèle Inventory, migration et services ledger — PR #87 ;
- [x] intégration GoodsReceipt → Inventory ;
- [x] Expenses — spécification dédiée : `Docs/79_PHASE_7_EXPENSES_EXECUTION_SPEC.md`, plan : `Docs/superpowers/plans/2026-10-14-phase-7-expenses-plan.md`, issue #92, PR #93 ;
- [x] CashAccounts/CashMovements — spécification dédiée : `Docs/80_PHASE_7_CASH_EXECUTION_SPEC.md`, plan : `Docs/superpowers/plans/2026-10-14-phase-7-cash-plan.md`, issue #95, PR #97, preuves finales PR #99 ;
- [x] preuves finales cross-phase et clôture stricte — PR #101 et
  `Docs/79_PHASE_7_CLOSURE_EVIDENCE.md`.

## Task 2 — Inventory livré

- [x] `InventoryMovement` append-only, tenant/establishment/warehouse/item scoped ;
- [x] `InventoryBalance` projection transactionnelle et reconstruction par agrégation du ledger ;
- [x] mouvements entrants, sortants, ajustements et transferts atomiques ;
- [x] idempotence, unicité des sources, contrôle de concurrence et refus des soldes négatifs ;
- [x] audit et Outbox dans la même transaction que l'écriture métier ;
- [x] tests PostgreSQL d'isolation tenant, concurrence, rejeu, transfert et immutabilité ;
- [x] migration base vide et upgrade depuis la Phase 6 ;
- [x] CI PR #237 et post-merge #238 vertes.

Preuves : [PR #87](https://github.com/jupi-z/Monarque-Connect/pull/87),
`main@9364379d868c536f9d4c7fe9da37934e4f5581e7`,
[CI PR #237](https://github.com/jupi-z/Monarque-Connect/actions/runs/38518975389),
[CI post-merge #238](https://github.com/jupi-z/Monarque-Connect/actions/runs/38519336517).

## Task 3 — GoodsReceipt → Inventory livré

- [x] événements confirmés/corrigés enrichis avec des faits par ligne immuables ;
- [x] lien tenant/établissement/réception/entrepôt et entrées source versionnées ;
- [x] consumer Outbox idempotent avec receipt et mouvements dans la même transaction PostgreSQL ;
- [x] affectation explicite d'un entrepôt actif, sans déduction implicite ;
- [x] corrections signées append-only et import historique `HISTORICAL_IMPORT` ;
- [x] audit, Outbox, rollback, rejeu et source/révision unique couverts ;
- [x] tests PostgreSQL du flux pending → assignment → correction et import historique ;
- [x] migration base vide et upgrade Phase 6 vérifiés par `prisma:phase7:migration-proof` ;
- [x] CI PR #245 et CI post-merge `main` #246 vertes.

Preuves Task 3 : [PR #90](https://github.com/jupi-z/Monarque-Connect/pull/90),
[CI PR #245](https://github.com/jupi-z/Monarque-Connect/actions/runs/38530801552),
[CI post-merge #246](https://github.com/jupi-z/Monarque-Connect/actions/runs/38531225477),
[commit `a09cbc2`](https://github.com/jupi-z/Monarque-Connect/commit/a09cbc2a5d75e85d67a9d2b898a0acad4c1c0930).
Les deux exécutions valident lint, typecheck, migrations, OpenAPI, contrats,
200 tests, 6 E2E, build et smoke HTTP.

## Task 4 — Expenses livré

- [x] cycle de vie `DRAFT → RECORDED → VOID`, avec enregistrement immuable et motif de void obligatoire ;
- [x] isolation organization/establishment et vérification de portée ;
- [x] rattachement optionnel à une `BusinessParty` tenant-scoped ; les références Project, Document et Cash restent explicitement hors périmètre jusqu'à la livraison de leurs domaines propriétaires ;
- [x] idempotence des commandes create/update/record/void avec détection de payload divergent ;
- [x] audit et événements Outbox atomiques avec la mutation métier ;
- [x] rollback PostgreSQL prouvé si l'écriture Outbox échoue ;
- [x] contrats OpenAPI et régressions PostgreSQL validés par la CI ;
- [x] migration base vide et upgrade cross-phase validés par la CI ;
- [x] CI PR #250 et CI post-merge #251 vertes.

Preuves Task 4 : [PR #93](https://github.com/jupi-z/Monarque-Connect/pull/93),
[CI PR #250](https://github.com/jupi-z/Monarque-Connect/actions/runs/38546544862),
[CI post-merge #251](https://github.com/jupi-z/Monarque-Connect/actions/runs/38546971416),
[commit `94f0e70`](https://github.com/jupi-z/Monarque-Connect/commit/94f0e7066b4bb4c34d87e28e665b4686c07ce6c8).
Les jobs `validate` des deux exécutions ont terminé avec `success`, notamment
pour lint, typecheck, migrations, OpenAPI, contrats, `npm test`, E2E HTTP,
build et smoke HTTP.

## Décisions toujours verrouillées

- [x] un seul ledger Inventory autoritaire, append-only et tenant-scoped ;
- [x] GoodsReceipt Phase 6 ne crée pas directement de mouvement Inventory ;
- [x] corrections par deltas compensatoires, jamais par édition historique ;
- [x] modules canoniques `INVENTORY`, `EXPENSES`, `CASH` ;
- [x] aucune règle fiscale, comptable ou réglementaire juridictionnelle inventée ;
- [x] migrations additives et preuves PostgreSQL ;
- [x] intégration événementielle GoodsReceipt, affectation entrepôt et historique ;
- [x] Expenses et Cash entièrement implémentés et prouvés sur leurs tranches respectives.

## Gates de clôture

- [x] contrat OpenAPI détaillé validé et compté par le validateur ;
- [x] modèles et contraintes tenant/établissement PostgreSQL pour Inventory ;
- [x] moteur Inventory unique sans second ledger ;
- [x] balances Inventory reconstructibles et testées ;
- [x] GoodsReceipt idempotente, historique et corrections prouvés côté Inventory ;
- [x] Expenses avec transitions, isolation, idempotence, audit et Outbox ;
- [x] CashAccounts/CashMovements append-only et solde dérivé ;
- [x] autorisation, entitlements, activation, rôles et scopes pour les contrats Operations ;
- [x] audit + Outbox atomiques pour le ledger Inventory ;
- [x] idempotence, concurrence et rollback pour le ledger Inventory ;
- [x] migration base vide et upgrade Phase 6 ;
- [x] tests PostgreSQL, E2E et non-régression Phases 0 à 6 sur la tranche livrée ;
- [x] CI PR et post-merge `main` vertes pour les Tasks 2 et 3 ;
- [x] documentation finale, issue #84 et tracker synchronisés pour la clôture finale de Phase 7.

La Phase 7 est clôturée à 100 % après preuve de chaque gate et synchronisation
des artefacts GitHub.

## Task 5 — Cash livré

- [x] cycle de vie CashAccount `ACTIVE → INACTIVE → ACTIVE`, code unique et solde dérivé ;
- [x] CashMovement append-only, montants positifs, devise du compte et corrections compensatoires ;
- [x] transferts same-currency en deux écritures liées dans une transaction ;
- [x] références Expense/PaymentRecord validées dans le tenant et l'établissement ;
- [x] idempotence, verrouillage de compte, refus des sorties insuffisantes et rollback Outbox ;
- [x] isolation tenant/établissement, entitlement `CASH`, permissions et audit atomiques ;
- [x] migration additive et preuves base vide/upgrade exécutées par la CI ;
- [x] tests PostgreSQL, 7 tests Cash, 212 tests de régression, 2 tests E2E HTTP Cash, build et smoke health.

Preuves Task 5 : [PR #97](https://github.com/jupi-z/Monarque-Connect/pull/97),
[PR corrective #99](https://github.com/jupi-z/Monarque-Connect/pull/99),
[CI PR #266](https://github.com/jupi-z/Monarque-Connect/actions/runs/38565073106),
[CI post-merge #267](https://github.com/jupi-z/Monarque-Connect/actions/runs/38565603162),
[commit `58b4193`](https://github.com/jupi-z/Monarque-Connect/commit/58b4193b35f648234122bc277ed0ecae9701e468).
La preuve de migration vérifie les tables, le trigger append-only, les
contraintes et les index Cash depuis une base vide et lors de l'upgrade. La
preuve HTTP couvre l'idempotence, le solde dérivé, le transfert lié et
l'isolation inter-tenant. Les contrôleurs Cash sont protégés par `AuthGuard`.

## Task 6 — Preuves cross-phase et Task 7 — clôture

- [x] script de preuve des migrations depuis une base vide et upgrade Phase 6 ;
- [x] vérification des tables, contraintes, triggers append-only et index
  d'idempotence Inventory/Expenses/Cash ;
- [x] seed de référence exécuté deux fois sans données opérationnelles ;
- [x] scénario HTTP Expenses → Cash et GoodsReceipt → Inventory avec worker,
  affectation explicite et solde dérivé ;
- [x] régression de sécurité : ExpenseController protégé par `AuthGuard` ;
- [x] CI PR #101/#272 et CI post-merge #273 vertes ;
- [x] issue #84 et tracker #11 synchronisés après fusion de la clôture.

Preuves finales : [PR #101](https://github.com/jupi-z/Monarque-Connect/pull/101),
[CI PR #272](https://github.com/jupi-z/Monarque-Connect/actions/runs/38573090855),
[CI post-merge #273](https://github.com/jupi-z/Monarque-Connect/actions/runs/38573746039),
[commit `c248f01`](https://github.com/jupi-z/Monarque-Connect/commit/c248f0170a23a1b55b2e0386a5e865d5cc9e96aa).
