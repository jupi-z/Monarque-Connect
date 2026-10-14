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

## Preuves attendues avant clôture

- [x] tests unitaires de canonisation et frontière DTO ;
- [x] tests de métadonnées d'enregistrement et `AuthGuard` ;
- [ ] tests PostgreSQL de rejeu divergent, transfert unilatéral et
  réconciliation idempotente ;
- [ ] E2E HTTP des balances, mouvements, alias, transferts et réconciliation,
  avec cas `401/403/404/409` ;
- [x] validation OpenAPI, contrats, Prisma, typecheck, lint et build ;
- [ ] CI GitHub de la PR corrective verte ;
- [ ] CI GitHub post-fusion verte avec migrations base vide et upgrade Phase 6 ;
- [ ] issue #84 refermée et tracker #11 resynchronisé après preuves post-fusion.

## Gouvernance

La correction ne modifie aucun ledger existant ni aucune migration historique.
Elle suit branche dédiée → PR → CI → fusion contrôlée → suppression de branche.
La Phase 8 reste fermée jusqu'à la clôture prouvée de cette tranche.
