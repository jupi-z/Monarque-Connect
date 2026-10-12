# 68 — Preuves de la tranche Phase 4 — trust et discovery Network

## Portée

Cette preuve couvre la lecture publique du trust plateforme et la découverte
publique paginée. Elle ne clôt pas la Phase 4, qui comprend encore les
connexions, les `NetworkInquiry` et leur conversion idempotente vers le CRM.

## Livraison fonctionnelle

- statut de confiance plateforme `UNVERIFIED`, `VERIFIED` ou `EXPIRED` ;
- lecture trust uniquement lorsque le profil organisationnel est public ;
- credentials publics filtrés par une projection allowlistée (`label`, `issuer`,
  `validUntil`) ;
- aucun endpoint tenant ne permet une auto-déclaration de vérification ;
- découverte publique sur nom, type d'entreprise et statut vérifié ;
- pagination déterministe par curseur `(updatedAt, organizationId)` ;
- découverte limitée aux profils publics d'organisations actives ;
- réponses discovery et trust sans handle, memberships, entitlements ou
  autres données privées.

## Fichiers principaux

- `prisma/schema.prisma` ;
- `prisma/migrations/20261012220000_add_network_trust/migration.sql` ;
- `src/network/discovery.*` et `src/network/trust.service.ts` ;
- `tests/network/discovery-trust.integration.test.ts` ;
- `openapi/openapi.yaml`.

## Contrôles locaux exécutés

Sur PostgreSQL réel avec `TEST_DATABASE_URL` :

- test discovery/trust ciblé : **3 tests passés** ;
- suite complète : **30 fichiers, 110 tests passés** ;
- `npm run typecheck` : passé ;
- `npm run lint` : passé ;
- `npm run build` : passé ;
- `npm run openapi:validate` : **105 opérations valides** ;
- `npm run contracts:validate` : passé ;
- `npm run prisma:validate` : passé ;
- preuves migrations Phase 2 et Phase 3 : passées avec **17 migrations**.

## Preuves GitHub

À compléter après création de la PR, validation de tous les jobs CI, fusion
sur `main`, suppression de la branche et exécution de la CI post-merge.
Aucun contrôle GitHub n'est déclaré réussi avant observation effective.

## Limites assumées

La tranche ne crée pas encore les connexions B2B ni les `NetworkInquiry`. La
Phase 4 reste ouverte jusqu'à preuve de tous les gates de la spécification
`64_PHASE4_CRM_NETWORK_EXECUTION_SPEC.md`.
