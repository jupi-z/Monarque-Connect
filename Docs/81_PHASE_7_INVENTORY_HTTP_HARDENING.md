# Phase 7 — Stabilisation corrective Inventory HTTP

## Motif

L'audit indépendant du 14 octobre 2026 a confirmé la livraison initiale de la
Phase 7, mais a identifié trois écarts bloquants avant clôture fonctionnelle :

1. les contrôleurs HTTP Inventory prévus dans OpenAPI n'étaient pas tous
   enregistrés ;
2. les rejeux d'une clé d'idempotence ne comparaient pas le payload canonique ;
3. le endpoint générique de mouvement permettait théoriquement des écritures
   `TRANSFER_IN`/`TRANSFER_OUT` isolées.

La réconciliation normative, présente dans le contrat OpenAPI et la
spécification Phase 7 mais absente du runtime, est livrée dans la même tranche
corrective afin de fournir une comparaison persistante, idempotente et
auditable sans modifier le ledger.

## Corrections livrées

- contrôleurs protégés par `AuthGuard` pour balances, mouvements, transferts,
  réconciliation et l'alias `stock-movements` ;
- contrôles centralisés `INVENTORY` + permission + scope établissement dans
  les services ;
- comparaison canonique des commandes de mouvement et de transfert ; un
  payload divergent réutilisant la même clé produit `409` ;
- DTO HTTP public limité aux ajustements manuels ; les transferts passent
  uniquement par la commande atomique dédiée ;
- modèle `InventoryReconciliation` et migration additive ; la réconciliation
  calcule le ledger, signale l'écart et écrit audit + Outbox dans une transaction
  sans corriger silencieusement le stock.

## Preuves finales de clôture

- [x] tests unitaires de canonisation et frontière DTO ;
- [x] tests de métadonnées d'enregistrement et `AuthGuard` ;
- [x] tests PostgreSQL de rejeu divergent, transfert unilatéral et
  réconciliation idempotente ;
- [x] E2E HTTP des balances, mouvements, alias, transferts et réconciliation,
  avec cas `401/403/404/409` ;
- [x] validation OpenAPI, contrats, Prisma, typecheck, lint et build ;
- [x] CI GitHub de la PR corrective verte : [PR #103](https://github.com/jupi-z/Monarque-Connect/pull/103),
  [Backend CI #278](https://github.com/jupi-z/Monarque-Connect/actions/runs/38589247495),
  job `validate` : `success` ;
- [x] CI GitHub post-fusion verte avec migrations base vide et upgrade Phase 6 :
  [Backend CI #279](https://github.com/jupi-z/Monarque-Connect/actions/runs/38608905102),
  job `validate` : `success` ;
- [x] issue #84 refermée et tracker #11 resynchronisé après les preuves
  post-fusion.

## Résultats reproductibles observés

- `main` post-fusion : [`c26f39c`](https://github.com/jupi-z/Monarque-Connect/commit/c26f39ce8b57f3213f315ea843688db229acd09e) ;
- 32 migrations appliquées depuis une base vide ; upgrade Phase 6 : 27 + 5
  migrations ; seed de référence idempotent sans fixtures opérationnelles ;
- OpenAPI : 152 opérations valides ;
- suite complète : 60 fichiers et 222 tests réussis ;
- E2E dédié : 5 fichiers et 10 tests réussis ;
- build, smoke HTTP, lint, typecheck, Prisma validate/deploy et contrats
  réussis.

## Gouvernance

La correction ne modifie aucun ledger existant ni aucune migration historique.
Elle suit branche dédiée → PR → CI → fusion contrôlée → suppression de branche.
La Phase 8 reste fermée pendant cette tranche corrective ; son ouverture fera
l'objet d'une décision distincte après cette clôture.
