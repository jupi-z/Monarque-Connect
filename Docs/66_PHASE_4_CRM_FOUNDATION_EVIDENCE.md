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

La preuve GitHub Actions et le commit `main` correspondant seront ajoutés
après fusion de la PR de cette tranche. Tant que cette vérification post-merge
n'est pas observée, cette tranche n'est pas déclarée fusionnée ni la Phase 4
clôturée.
