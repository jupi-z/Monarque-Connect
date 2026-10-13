# 78 — Phase 7 Operations — Statut d'ouverture

## État actuel

La Phase 7 — Operations est **ouverte officiellement en cadrage** sur
`main@3b7245469a2b9ee2a2ccb19c04f621d1d75497ec`.

Elle n'est pas livrée et aucun gate d'implémentation n'est coché. La présente
PR versionne la spécification, le plan et les corrections de cohérence
normative nécessaires avant toute migration ou code métier.

Suivi : [issue #84](https://github.com/jupi-z/Monarque-Connect/issues/84).

## Artefacts

- [x] `Docs/77_PHASE7_OPERATIONS_EXECUTION_SPEC.md` — spécification normative ;
- [x] `Docs/78_PHASE_7_STATUS.md` — statut et gates ;
- [x] `Docs/superpowers/plans/2026-10-14-phase-7-operations-plan.md` — plan séquencé ;
- [x] roadmap et documents normatifs Phase 6/Operations réconciliés ;
- [ ] contrat OpenAPI détaillé et validé ;
- [ ] migrations et modèles PostgreSQL ;
- [ ] code métier et tests d'intégration.

## Décisions verrouillées par ce cadrage

- [x] un seul ledger Inventory autoritaire, append-only et tenant-scoped ;
- [x] balances de stock et de caisse dérivées d'écritures reconstructibles ;
- [x] GoodsReceipt Phase 6 sans écriture directe de stock ;
- [x] consommateur Phase 7 dédupliqué par événement, source, ligne et révision ;
- [x] affectation de réception à un entrepôt obligatoire et explicite ;
- [x] réceptions historiques sans backfill automatique ; import explicite, idempotent et audité ;
- [x] corrections par deltas compensatoires, jamais par édition historique ;
- [x] modules canoniques `INVENTORY`, `EXPENSES`, `CASH` ;
- [x] aucune règle fiscale, comptable ou réglementaire juridictionnelle inventée ;
- [x] migrations additives depuis la clôture Phase 6 et preuves PostgreSQL/E2E.

## Séquençage approuvé

1. finaliser et valider le contrat OpenAPI et les permissions ;
2. implémenter le ledger Inventory, la projection et les contrôles de concurrence ;
3. intégrer GoodsReceipt confirmé/corrigé, affectation et historique ;
4. implémenter Expenses et leurs liens explicites ;
5. implémenter CashAccounts/CashMovements et les transferts ;
6. produire migrations, preuves cross-phase, E2E, régressions et clôture.

Chaque tranche suivra : branche dédiée → PR → CI verte → fusion contrôlée →
suppression de branche. Aucun push direct sur `main`.

## Gates de sortie non encore validés

- [ ] contrat OpenAPI détaillé validé et compté par le validateur ;
- [ ] modèles et contraintes tenant/établissement PostgreSQL ;
- [ ] moteur Inventory unique sans second ledger ;
- [ ] balances reconstructibles et réconciliation testée ;
- [ ] GoodsReceipt idempotente, historique et corrections prouvés ;
- [ ] Expenses avec transitions et audit ;
- [ ] CashAccounts/CashMovements append-only et solde dérivé ;
- [ ] autorisation, entitlements, activation, rôles et scopes ;
- [ ] audit + Outbox atomiques ;
- [ ] idempotence, concurrence et rollback ;
- [ ] migration base vide et upgrade Phase 6 ;
- [ ] tests PostgreSQL, E2E et non-régression Phases 0 à 6 ;
- [ ] CI PR et post-merge `main` vertes ;
- [ ] documentation, issue #84, tracker et branches synchronisés.

La Phase 7 ne sera déclarée clôturée qu'après preuve de chaque case.
