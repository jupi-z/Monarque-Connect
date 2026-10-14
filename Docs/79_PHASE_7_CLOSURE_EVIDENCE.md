# 79 — Phase 7 Operations — Preuve de clôture

> **Addendum final — 14 octobre 2026.** La stabilisation corrective Inventory
> HTTP a été livrée par la [PR #103](https://github.com/jupi-z/Monarque-Connect/pull/103)
> et fusionnée sur [`main@c26f39c`](https://github.com/jupi-z/Monarque-Connect/commit/c26f39ce8b57f3213f315ea843688db229acd09e).
> La [CI PR #278](https://github.com/jupi-z/Monarque-Connect/actions/runs/38589247495)
> et la [CI post-fusion #279](https://github.com/jupi-z/Monarque-Connect/actions/runs/38608905102)
> sont vertes. Les contrôleurs Inventory, la canonisation d'idempotence, la
> frontière des transferts et la réconciliation persistante sont donc prouvés.
> L'issue #84 et le tracker #11 sont resynchronisés après ces preuves.

## Décision

La Phase 7 — Operations est clôturée à 100 % sur la base technique finale
`main@c26f39ce8b57f3213f315ea843688db229acd09e`, sous réserve de la politique
de gouvernance documentée pour la protection native de `main`. La phase couvre
Inventory, l'intégration GoodsReceipt → Inventory, Expenses et
CashAccounts/CashMovements. La Phase 8 n'est pas ouverte par cette preuve.

Cette preuve ne formule aucune conclusion fiscale, comptable ou réglementaire
propre à une juridiction.

## Provenance et gouvernance

- Baseline Phase 6 : `main@3b7245469a2b9ee2a2ccb19c04f621d1d75497ec`.
- PR de preuve cross-phase : [PR #101](https://github.com/jupi-z/Monarque-Connect/pull/101).
- PR head validée : `c83ff02b30ad23f2c80edc74b56657858741abaf`.
- CI PR initiale : [Backend CI #270](https://github.com/jupi-z/Monarque-Connect/actions/runs/38571705514) — échouée sur une erreur de requête de preuve d'index, corrigée avant fusion.
- CI PR finale : [Backend CI #272](https://github.com/jupi-z/Monarque-Connect/actions/runs/38573090855) — job `validate` : `success`.
- Commit squash fusionné de la clôture initiale : [`c248f017`](https://github.com/jupi-z/Monarque-Connect/commit/c248f0170a23a1b55b2e0386a5e865d5cc9e96aa).
- PR corrective Inventory HTTP : [PR #103](https://github.com/jupi-z/Monarque-Connect/pull/103), head CI validée [`9aa7c38e`](https://github.com/jupi-z/Monarque-Connect/commit/9aa7c38e03927f076f95ee79220372ca485d2929).
- CI PR corrective : [Backend CI #278](https://github.com/jupi-z/Monarque-Connect/actions/runs/38589247495) — job `validate` : `success`.
- Commit squash final : [`c26f39ce`](https://github.com/jupi-z/Monarque-Connect/commit/c26f39ce8b57f3213f315ea843688db229acd09e).
- CI post-merge finale : [Backend CI #279](https://github.com/jupi-z/Monarque-Connect/actions/runs/38608905102) — job `validate` : `success`.
- Les branches de travail sont supprimées après fusion selon la gouvernance du dépôt ; `main` reste la seule branche distante conservée.
- La protection native de `main` reste indisponible sur le plan GitHub actuel. La mesure compensatoire obligatoire demeure : branche dédiée, PR, CI verte, fusion contrôlée et suppression de la branche fusionnée.

## Preuves de migration PostgreSQL

Le step CI `Verify empty-database and Phase 6 upgrade migrations` est terminé
avec succès dans la CI post-merge #273.

- Base vide : 32 migrations appliquées, jusqu'à la dernière migration Phase 7.
- Upgrade Phase 6 : 27 migrations historiques puis 5 migrations Phase 7.
- Schéma Phase 7 vérifié : tables Inventory, liens et entrées GoodsReceipt,
  Expenses, idempotence Expenses, CashAccounts, idempotence Cash, CashMovements
  et InventoryReconciliations.
- Contraintes vérifiées : directions Inventory, quantité de balance non négative,
  delta GoodsReceipt non nul, devise Cash normalisée, montant positif, source
  Cash et correction Cash.
- Triggers append-only vérifiés pour les ledgers Inventory et Cash.
- Index d'unicité vérifiés pour l'organisation/code Cash, les corrections Cash,
  l'idempotence Cash et l'idempotence Expense.
- Seed de référence exécuté deux fois sur la base vide et sur l'upgrade ; aucun
  mouvement Inventory, Expense ou mouvement Cash opérationnel n'est créé.
- Les tables historiques interdites `stock_movements` et `stock_balances`
  sont absentes.

## Preuves fonctionnelles cross-phase

La suite de régression de la CI #279 rapporte :

- 60 fichiers de tests réussis ;
- 222 tests réussis ;
- 5 fichiers E2E et 10 tests E2E réussis ;
- OpenAPI : 152 opérations valides ;
- contrats d'événements et exemple contractuel valides ;
- lint, typecheck, Prisma validate/deploy, build et smoke HTTP réussis.

Le scénario E2E Phase 7 prouve :

1. exposition HTTP des balances, mouvements, transferts, réconciliation et
   alias de compatibilité Inventory ;
2. rejeu divergent refusé en `409`, transfert unilatéral refusé et contrôles
   `401/403/404` ;
3. création et enregistrement HTTP d'une Expense ;
4. création d'un CashMovement sortant référencé par cette Expense ;
5. calcul du solde dérivé après l'écriture ;
6. confirmation d'une GoodsReceipt ;
7. traitement Outbox par le worker ;
8. mise en attente explicite de la réception avant affectation ;
9. affectation à un entrepôt ;
10. projection d'un mouvement Inventory unique et d'un solde de `2.000000`.

La régression de sécurité vérifie également que `ExpenseController` est
protégé par l'`AuthGuard` central.

## Gates de clôture

- [x] contrat OpenAPI et permissions Operations validés avant le métier ;
- [x] moteur Inventory unique, append-only, transactionnel et tenant-scoped ;
- [x] balances Inventory reconstructibles et contrôle de concurrence ;
- [x] GoodsReceipt idempotente, corrections compensatoires et import historique ;
- [x] Expenses avec cycle de vie, idempotence, audit et Outbox atomiques ;
- [x] Cash avec ledger append-only, solde dérivé, transferts et corrections ;
- [x] isolation tenant/établissement, entitlements, activation, rôles et scopes ;
- [x] migrations base vide et upgrade Phase 6 ;
- [x] seed de référence idempotent sans fixtures opérationnelles ;
- [x] tests PostgreSQL, E2E, OpenAPI, contrats, build et smoke HTTP ;
- [x] CI PR et post-merge vertes ;
- [x] issue #84 et tracker #11 synchronisés ;
- [x] aucune modification de migration existante dans la PR de clôture ;
- [x] aucun second moteur de stock et aucune ouverture de Phase 8.

## Limites explicitement conservées

La protection native de `main` n'est pas présentée comme active : son
indisponibilité est suivie par l'issue #6. La CI verte prouve les contrôles
exécutés, mais ne transforme pas cette limitation GitHub en règle serveur.
Jusqu'à changement de capacité du dépôt, toute contribution doit donc respecter
strictement le processus compensatoire versionné dans la roadmap.

## Références

- [Spécification Phase 7](77_PHASE7_OPERATIONS_EXECUTION_SPEC.md)
- [Statut Phase 7](78_PHASE_7_STATUS.md)
- [Plan d'exécution Phase 7](superpowers/plans/2026-10-14-phase-7-operations-plan.md)
