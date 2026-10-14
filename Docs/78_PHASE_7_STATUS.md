# 78 — Phase 7 Operations — Statut d'exécution

## État actuel

La Phase 7 — Operations est ouverte et en cours d'exécution sur
`main@9364379d868c536f9d4c7fe9da37934e4f5581e7`.

Le cadrage et le contrat Operations sont intégrés. Les Tasks 2 et 3 — Inventory
ledger, balances et intégration GoodsReceipt — sont livrés et vérifiés. La phase
reste volontairement ouverte tant que Expenses, Cash et les preuves finales ne
sont pas toutes démontrées.

Suivi : [issue #84](https://github.com/jupi-z/Monarque-Connect/issues/84).

## Artefacts et tranches

- [x] `Docs/77_PHASE7_OPERATIONS_EXECUTION_SPEC.md` — spécification normative ;
- [x] `Docs/78_PHASE_7_STATUS.md` — statut et gates ;
- [x] `Docs/superpowers/plans/2026-10-14-phase-7-operations-plan.md` — plan séquencé ;
- [x] contrat OpenAPI et autorisations centrales — PR #86 ;
- [x] modèle Inventory, migration et services ledger — PR #87 ;
- [x] intégration GoodsReceipt → Inventory ;
- [ ] Expenses ;
- [ ] CashAccounts/CashMovements ;
- [ ] preuves finales cross-phase et clôture stricte.

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
- [ ] preuves CI de la PR et du post-merge à compléter après fusion.

## Décisions toujours verrouillées

- [x] un seul ledger Inventory autoritaire, append-only et tenant-scoped ;
- [x] GoodsReceipt Phase 6 ne crée pas directement de mouvement Inventory ;
- [x] corrections par deltas compensatoires, jamais par édition historique ;
- [x] modules canoniques `INVENTORY`, `EXPENSES`, `CASH` ;
- [x] aucune règle fiscale, comptable ou réglementaire juridictionnelle inventée ;
- [x] migrations additives et preuves PostgreSQL ;
- [ ] intégration événementielle GoodsReceipt, affectation entrepôt et historique ;
- [ ] Expenses et Cash entièrement implémentés et prouvés.

## Gates de clôture

- [x] contrat OpenAPI détaillé validé et compté par le validateur ;
- [x] modèles et contraintes tenant/établissement PostgreSQL pour Inventory ;
- [x] moteur Inventory unique sans second ledger ;
- [x] balances Inventory reconstructibles et testées ;
- [x] GoodsReceipt idempotente, historique et corrections prouvés côté Inventory ;
- [ ] Expenses avec transitions et audit ;
- [ ] CashAccounts/CashMovements append-only et solde dérivé ;
- [x] autorisation, entitlements, activation, rôles et scopes pour les contrats Operations ;
- [x] audit + Outbox atomiques pour le ledger Inventory ;
- [x] idempotence, concurrence et rollback pour le ledger Inventory ;
- [x] migration base vide et upgrade Phase 6 ;
- [x] tests PostgreSQL, E2E et non-régression Phases 0 à 6 sur la tranche livrée ;
- [x] CI PR et post-merge `main` vertes pour le Task 2 ;
- [ ] documentation, issue #84, tracker et branches synchronisés pour la clôture finale.

La Phase 7 ne sera déclarée clôturée qu'après preuve de chaque gate restante.
