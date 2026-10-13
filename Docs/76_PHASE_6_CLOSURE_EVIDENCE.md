# Phase 6 — Purchases — Evidence de migration et E2E

## Objet

Ce document rassemble les preuves exécutables de la Task 6 de la Phase 6 —
Purchases. Il ne clôt pas la phase à lui seul : la clôture normative reste
conditionnée à la validation GitHub de la PR, à la CI post-merge sur `main` et
à la synchronisation finale de l'issue #75, du tracker et de la roadmap.

Le périmètre vérifié est :

`SupplierRFQ → PurchaseOrder → GoodsReceipt`

Les Goods Receipts constatent une réception et publient des événements
Outbox ; cette preuve vérifie qu'aucun moteur Inventory n'est créé ou muté par
Phase 6.

## Preuve de migrations

La commande `npm run prisma:phase6:migration-proof` crée deux bases PostgreSQL
temporaires, applique les migrations dans un espace Prisma temporaire, vérifie
les noms réellement enregistrés dans `_prisma_migrations`, vérifie les tables
et colonnes Phase 6 et supprime les bases ainsi que l'espace temporaire dans un
bloc `finally`.

Le découpage contrôlé est :

- base vide complète : **27 migrations** appliquées jusqu'à
  `20261013210000_add_purchase_order_totals` ;
- upgrade depuis la baseline Phase 5 : **24 migrations Phase 5**, puis les
  **3 migrations Phase 6** :
  `20261013170000_add_purchase_documents`,
  `20261013180000_add_purchase_idempotency` et
  `20261013210000_add_purchase_order_totals` ;
- preuve structurelle : les neuf tables RFQ/PO/Goods Receipt et les totaux de
  commande sont présents ; les tables interdites
  `stock_movements`, `inventory_balances` et `stock_balances` ne sont pas
  introduites.

Sortie locale vérifiée le 13/10/2026 :

```text
Phase 6 migration proof passed: empty database (27 migrations) and Phase 5 upgrade (24 + 3 migrations).
```

## Preuve E2E PostgreSQL

Le fichier `tests/e2e/phase6-purchases.e2e.test.ts` vérifie contre une base
PostgreSQL réelle :

1. création d'une RFQ fournisseur et envoi ;
2. attribution à un Purchase Order ;
3. envoi et confirmation de la commande ;
4. création et confirmation d'une réception partielle ;
5. correction compensatoire append-only et cumul net ;
6. statut `PARTIALLY_RECEIVED` de la commande ;
7. audit/Outbox des trois mutations de réception ;
8. absence de variation des lignes `Warehouse` et `Item` ;
9. refus d'accès par un autre tenant et par un membre limité à un autre
   établissement.

Sortie locale ciblée vérifiée le 13/10/2026 :

```text
Test Files  1 passed (1)
Tests       2 passed (2)
```

La suite E2E complète (`npm run test:e2e`) et la suite de non-régression
complète (`npm test`) restent des gates de PR et de clôture ; leurs résultats
finaux doivent être consignés après exécution CI.

## Compatibilité inter-phases

- La migration Phase 6 démarre après la dernière migration Phase 5 sans
  réécrire les migrations antérieures.
- Les primitives d'autorisation, d'idempotence, de numérotation, d'audit et
  d'Outbox existantes sont réutilisées.
- Les routes Purchases restent sous `/api/v1` et les contrats OpenAPI sont
  validés par les contrôles existants.
- Aucun service Purchases n'écrit dans Inventory ; un consommateur futur de
  Phase 7 pourra traiter les événements versionnés selon ses propres
  invariants.

## Gates restant à prouver

- [ ] suite E2E complète et suite Vitest complète sur le commit de PR ;
- [ ] lint, typecheck, Prisma validate, OpenAPI, contrats et build sur le
  commit de PR ;
- [ ] CI PR verte et CI post-merge `main` verte ;
- [ ] synchronisation finale du statut Phase 6, de la roadmap, du tracker et
  de l'issue #75 ;
- [ ] suppression de la branche de livraison après fusion.
