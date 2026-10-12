# 69 — Preuves de la tranche Phase 4 — connexions Network

## Portée

Cette preuve couvre les demandes de connexion B2B entre organisations. Elle ne
clôt pas la Phase 4 : les `NetworkInquiry`, leur conversion idempotente vers le
CRM et les preuves de clôture globale restent à livrer.

## Livraison fonctionnelle

- modèle persistant `ConnectionRequest` avec les états
  `PENDING → ACCEPTED | DECLINED | CANCELLED` ;
- routes tenant-scoped `POST`, `GET` et `PATCH` conformes aux schémas OpenAPI
  existants ;
- contrôle partagé de l'organisation source : tenant actif, membership actif,
  entitlement effectif, activation et permission `network:connections:*` ;
- cible limitée aux organisations actives ayant un profil public et le module
  `NETWORK_CONNECTIONS` effectivement autorisé ;
- autorité séparée : la source peut annuler, la cible peut accepter ou refuser ;
  un tiers ou une mauvaise organisation reçoit un refus ;
- impossibilité de s'auto-cibler et prévention des demandes pendantes ou
  acceptées en double, y compris en concurrence, par verrou advisory PostgreSQL,
  index unique partiel et contrôle applicatif ;
- transitions terminales conditionnelles : deux réponses concurrentes ne
  produisent qu'un seul gagnant ;
- audit et événements Outbox transactionnels :
  `network.connection.requested` et `network.connection.status_changed` ;
- pagination par curseur et filtrage d'état sur la visibilité des deux
  organisations participantes.

## Fichiers principaux

- `prisma/schema.prisma` ;
- `prisma/migrations/20261012230000_add_network_connections/migration.sql` ;
- `src/network/connection.controller.ts` ;
- `src/network/connection.dto.ts` ;
- `src/network/connection.service.ts` ;
- `tests/network/connections.integration.test.ts` ;
- `openapi/openapi.yaml` — contrats des trois routes et schémas associés.

## Contrôles locaux exécutés

Sur PostgreSQL réel avec `TEST_DATABASE_URL` :

- test ciblé connexions : **4 tests passés** ;
- suite complète : **31 fichiers, 114 tests passés** ;
- `npm run lint` : passé ;
- `npm run typecheck` : passé ;
- `npm run build` : passé ;
- `npm run prisma:validate` : passé ;
- `npm run openapi:validate` : **105 opérations valides** ;
- `npm run contracts:validate` : passé ;
- `npm run prisma:phase2:migration-proof` : passé, base vide et upgrade
  Phase 1 ;
- `npm run prisma:phase3:migration-proof` : passé, base vide et upgrade
  Phase 2.

## Preuves GitHub observées

- PR fusionnée : [#58](https://github.com/jupi-z/Monarque-Connect/pull/58) ;
- commit `main` fusionné :
  `c7a6cff9978c70dcaa6af7e35e0b89fbbc9a2781` ;
- CI PR #182 :
  [38314175957](https://github.com/jupi-z/Monarque-Connect/actions/runs/38314175957),
  `Backend CI`, job `validate`, conclusion `success` ;
- les étapes observées sur ce run sont toutes réussies : installation,
  audit runtime, lint, typecheck, Prisma generate/validate/deploy, preuves de
  migration Phase 1 et Phase 2, OpenAPI, contrats, suite complète, build et
  smoke HTTP ;
- CI post-merge `main` #183 :
  [38314485537](https://github.com/jupi-z/Monarque-Connect/actions/runs/38314485537),
  `Backend CI`, job `validate`, conclusion `success` ; ses étapes obligatoires
  sont également toutes réussies ;
- branche `monarque/phase4-network-connections` supprimée après fusion.

## Limites assumées

La tranche ne crée pas les `NetworkInquiry` ni leur conversion idempotente vers
`Lead`/`Opportunity`. La Phase 4 reste ouverte jusqu'à la preuve complète des
gates de la spécification
[`64_PHASE4_CRM_NETWORK_EXECUTION_SPEC.md`](64_PHASE4_CRM_NETWORK_EXECUTION_SPEC.md).
