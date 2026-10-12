# 66 — Preuves de la tranche Phase 4 — CRM fondation

## Portée

Cette preuve couvre la première tranche métier de la Phase 4 : leads et
opportunités CRM. Elle ne clôt pas la Phase 4, qui comprend encore le Network,
les connexions, les `NetworkInquiry` et leur conversion idempotente vers le CRM.

## Livraison

- `Lead` tenant-scoped avec source `DIRECT` ou `NETWORK_INQUIRY`, statut et
  recherche paginée par curseur ;
- `Opportunity` tenant-scoped et établissement-scoped, avec valeur attendue,
  devise, source et pipeline minimal ;
- transitions serveur :
  `NEW → QUALIFIED → CONVERTED | DISMISSED` et
  `OPEN → WON | LOST | CANCELLED` ;
- contrôle commun `tenant actif → membership → entitlement → activation →
  permission → scope établissement` via `AuthorizationService` ;
- état, audit et Outbox écrits dans la même transaction Prisma ;
- protection concurrente par mise à jour conditionnelle sur le statut ; un
  retry idempotent ne crée pas de second audit ni de second événement ;
- référence `partyId` tenant-vérifiée et `networkInquiryId` conservée pour la
  tranche de conversion future.

## Fichiers principaux

- `prisma/schema.prisma` ;
- `prisma/migrations/20261012200000_add_phase4_crm_foundation/migration.sql` ;
- `src/crm/` ;
- `tests/crm/leads-opportunities.integration.test.ts` ;
- `openapi/openapi.yaml`.

## Contrôles exécutés localement

Sur PostgreSQL réel avec `TEST_DATABASE_URL` :

- test CRM ciblé : **5 tests passés** ;
- suite complète : **28 fichiers, 104 tests passés** ;
- `npm run typecheck` : passé ;
- `npm run lint` : passé ;
- `npm run build` : passé ;
- `npm run openapi:validate` : **105 opérations valides** ;
- `npm run contracts:validate` : passé ;
- `npm run prisma:validate` : passé ;
- `npm run prisma:phase2:migration-proof` : passé, base vide et upgrade Phase 1 ;
- `npm run prisma:phase3:migration-proof` : passé, base vide et upgrade Phase 2.

## Preuves GitHub observées

- PR fusionnée : [#52](https://github.com/jupi-z/Monarque-Connect/pull/52) ;
- commit `main` fusionné :
  `3a6e7ba229978ab5af8ccf6b031c0e10b41c93f5` ;
- CI PR corrective verte, run #170 :
  [38304124761](https://github.com/jupi-z/Monarque-Connect/actions/runs/38304124761) ;
- CI post-merge `main` verte, run #171 :
  [38304449756](https://github.com/jupi-z/Monarque-Connect/actions/runs/38304449756) ;
- job GitHub observé : `validate`, conclusion `success`, avec lint,
  typecheck, Prisma, migrations, OpenAPI, contrats, tests, build et smoke
  HTTP réussis ;
- branche de livraison `monarque/phase4-crm-foundation` supprimée après
  fusion ; `origin` ne conserve que `main`.

Le premier run PR #169 a échoué sur l'attendu de statut d'une course
concurrente (`400` observé contre `409` attendu). Le service a été corrigé,
le test ciblé et le run #170 ont ensuite été validés avant la fusion. Il ne
reste aucun contrôle obligatoire échoué sur le commit fusionné.

Cette preuve confirme la livraison de la tranche CRM, mais ne clôt pas la
Phase 4 : le Network, les connexions, les `NetworkInquiry` et la conversion
idempotente vers le CRM restent à implémenter et à prouver.
