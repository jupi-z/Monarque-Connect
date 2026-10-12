# 67 — Preuves de la tranche Phase 4 — profil Network

## Portée

Cette preuve couvre le profil Network d'organisation. Elle ne clôt pas la
Phase 4, qui comprend encore la confiance/vérification, la découverte, les
connexions, les `NetworkInquiry` et leur conversion idempotente vers le CRM.

## Livraison fonctionnelle

- profil privé créé à la première lecture authentifiée ;
- publication explicitement opt-in via `isPublic` ;
- projection publique limitée à `organizationId`, `displayName`,
  `description`, `businessTypeCode`, `categories`, `publicLocation`,
  `verified`, `publishedItemIds` et `publishedAt` ;
- aucune membership, donnée de contact privée, entitlement ou donnée interne
  n'est sérialisée par la route publique ;
- lecture et écriture tenant soumises au contrôle partagé avec le module
  `NETWORK_PROFILE` et les permissions `network:profile:read/write` ;
- profil privé non révélateur : la route publique répond `404` ;
- mutation effective atomique : état, audit et Outbox sont écrits dans la même
  transaction, tandis qu'une répétition sans changement ne produit pas de
  second audit ou événement.

## Fichiers principaux

- `prisma/schema.prisma` ;
- `prisma/migrations/20261012210000_add_network_profile/migration.sql` ;
- `src/network/` ;
- `tests/network/profile.integration.test.ts` ;
- `openapi/openapi.yaml`.

## Contrôles locaux exécutés

Sur PostgreSQL réel avec `TEST_DATABASE_URL` :

- test Network profile ciblé : **3 tests passés** ;
- suite complète : **29 fichiers, 107 tests passés** ;
- `npm run typecheck` : passé ;
- `npm run lint` : passé ;
- `npm run build` : passé ;
- `npm run openapi:validate` : **105 opérations valides** ;
- `npm run contracts:validate` : passé ;
- `npm run prisma:validate` : passé ;
- migration `20261012210000_add_network_profile` : appliquée avec
  `prisma migrate deploy`.

## Preuves GitHub observées

- PR fusionnée : [#54](https://github.com/jupi-z/Monarque-Connect/pull/54) ;
- commit `main` fusionné : `2db7d8205436bd7cae5160e2eb502b95505cf2d6` ;
- CI PR #174 :
  [38307308522](https://github.com/jupi-z/Monarque-Connect/actions/runs/38307308522),
  `Backend CI`, job `validate`, conclusion `success` ;
- CI post-merge `main` #175 :
  [38307633326](https://github.com/jupi-z/Monarque-Connect/actions/runs/38307633326),
  `Backend CI`, job `validate`, conclusion `success` ;
- pour les deux runs, les étapes observées sont toutes réussies : lint,
  typecheck, Prisma generate/validate/deploy, preuves de migrations Phase 1 et
  Phase 2, OpenAPI, contrats, suite complète, build et smoke HTTP ;
- branche `monarque/phase4-network-profile` supprimée après fusion ; le dépôt
  ne conserve que `main`.

## Limites assumées

La tranche ne crée pas encore la découverte paginée, la vérification/trust, les
connexions ou les `NetworkInquiry`. La Phase 4 reste ouverte jusqu'à preuve de
tous les gates de la spécification `64_PHASE4_CRM_NETWORK_EXECUTION_SPEC.md`.
