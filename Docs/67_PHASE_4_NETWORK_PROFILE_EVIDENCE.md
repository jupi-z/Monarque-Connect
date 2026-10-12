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

## Preuves GitHub

À compléter après création de la PR, validation de tous les jobs CI, fusion
sur `main` et exécution de la CI post-merge. Aucun contrôle GitHub n'est
déclaré réussi dans cette preuve avant observation effective.

## Limites assumées

La tranche ne crée pas encore la découverte paginée, la vérification/trust, les
connexions ou les `NetworkInquiry`. La Phase 4 reste ouverte jusqu'à preuve de
tous les gates de la spécification `64_PHASE4_CRM_NETWORK_EXECUTION_SPEC.md`.
