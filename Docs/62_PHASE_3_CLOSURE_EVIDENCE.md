# 62 — Phase 3 Référentiels — Preuves de clôture

## Référence

Cette preuve correspond à la baseline `main` issue du merge des PR #45 et #46,
préparée le 12 octobre 2026. La spécification normative est
[`60_PHASE3_REFERENTIALS_EXECUTION_SPEC.md`](60_PHASE3_REFERENTIALS_EXECUTION_SPEC.md).

## Fonctionnel livré

| Référentiel | Contrôle serveur | Données et événements | Tests |
|---|---|---|---|
| Business parties | membership actif, CRM actif, permission `parties:*` | `business_parties`, audit et `business_party.*` | création/liste, activation, refus CRM, isolation tenant |
| Items | membership actif, CATALOG actif, permission `catalog:*` | `items`, SKU partiel unique, audit et `catalog.item.*` | produit/service, prix décimal, SKU conflictuel, rôle et concurrence |
| Warehouses | membership actif, INVENTORY actif, permission `inventory:*`, scope établissement | `warehouses`, code unique, FK composite parent, audit et `warehouse.*` | parent tenant, scope sélectionné, lecture hors scope, idempotence et concurrence |

Les mutations état métier + audit + Outbox sont écrites dans la même transaction
Prisma. Les désactivations sont non destructives et une transition répétée
ne produit aucun nouvel audit ni événement.

## Vérifications locales reproductibles

Exécutées avec PostgreSQL 17 disponible sur `localhost:5432` :

```text
npm run prisma:phase3:migration-proof
→ Phase 3 migration proof passed: empty database (14 migrations) and Phase 2 upgrade (13 + 1 migrations).

npm test
→ 27 test files passed, 91 tests passed.

npm run test:e2e
→ 1 E2E file passed, 2 tests passed.

npm run openapi:validate
→ OpenAPI valid: 99 operations

npm run contracts:validate
→ domain-event schema, agent-action schema and organization.created example valid

npm run prisma:validate
→ The schema at prisma/schema.prisma is valid

npm run typecheck
npm run lint
npm run build
→ all passed
```

Les commandes d'intégration référentiels utilisent PostgreSQL réel et couvrent
les fichiers `tests/referentials/parties.integration.test.ts`,
`items.integration.test.ts` et `warehouses.integration.test.ts`. Les tests de
course sur SKU et codes vérifient que la contrainte PostgreSQL laisse une seule
création et retourne un conflit contrôlé pour la seconde.

## Preuve CI/GitHub

- PR #45 : référentiel parties, squash merge, Backend CI #156 verte ;
- PR #46 : catalogue, warehouses et fixtures FK, squash merge, Backend CI #158 verte ;
- branches `monarque/phase3-referentials-foundation` et
  `monarque/phase3-catalog-inventory` supprimées après merge ;
- la clôture finale synchronise l'issue #43 et le tracker #11.

## Hors périmètre confirmé

Les mouvements de stock, les workflows CRM, les ventes, les achats, la
découverte réseau, les projections publiques, l'import massif et l'IA ne sont
pas déclarés livrés par cette preuve.
