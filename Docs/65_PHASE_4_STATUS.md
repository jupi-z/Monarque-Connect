# 65 — Phase 4 CRM + Network — Statut

## État courant

La Phase 4 — CRM + Network entry est **ouverte en conception et préparation
d'exécution**. Elle n'est pas déclarée livrée et aucun endpoint métier Phase 4
n'est déclaré stable par ce document.

L'ouverture est portée par l'issue [#49](https://github.com/jupi-z/Monarque-Connect/issues/49)
et la spécification normative
[`64_PHASE4_CRM_NETWORK_EXECUTION_SPEC.md`](64_PHASE4_CRM_NETWORK_EXECUTION_SPEC.md).

Baseline de départ : `main` après la fusion de la stabilisation cross-phase PR
[#48](https://github.com/jupi-z/Monarque-Connect/pull/48), commit
`17095fe83a32328d3bf3d898b7adba2f4bfe5ff8`. La Phase 1, la Phase 2 et la Phase
3 sont considérées comme clôturées selon leurs preuves respectives.

## Progression

**Ouverture : 0 % de livraison métier — 100 % du cadrage d'ouverture.**

Ce ratio distingue explicitement le cadrage documentaire de l'implémentation.
Il ne doit pas être utilisé pour annoncer une fonctionnalité disponible.

## Périmètre

- [ ] leads et opportunités CRM ;
- [ ] profils publics d'organisation ;
- [ ] vérification et signaux de confiance publiables ;
- [ ] découverte réseau paginée et allowlistée ;
- [ ] connexions B2B ;
- [ ] `NetworkInquiry → CRM` idempotent ;
- [ ] migrations, OpenAPI, événements, audit, E2E et preuves de concurrence.

## Conditions d'entrée vérifiées

- [x] Phase 1 Identity & Tenancy sur `main` ;
- [x] Phase 2 Product Entitlements sur `main` ;
- [x] Phase 3 Référentiels sur `main` ;
- [x] stabilisation cross-phase PR #48 fusionnée avec CI verte ;
- [x] `main` synchronisée et sans branche distante résiduelle ;
- [x] roadmap et invariants existants relus ;
- [x] issue dédiée #49 créée ;
- [x] spécification d'exécution créée ;
- [x] plan d'exécution versionné créé.

## Jalon contrats CRM/Network

Le premier jalon d'exécution est préparé dans la branche
`monarque/phase4-contracts` :

- matrice de permissions tenant CRM/Network ajoutée à `AuthorizationService` ;
- états, transitions, visibilité publique et policy de contact initiale figés
  dans la spécification ;
- surfaces OpenAPI CRM/Network détaillées, avec schémas, pagination,
  idempotence et erreurs (`103` opérations validées localement) ;
- événements, classification, audit, Outbox et contraintes de concurrence
  définis avant modèle métier.

Ce jalon ne crée encore aucune table, migration ou route métier Phase 4. Les
choix d'indexation publique et de quotas Network restent explicitement ouverts
et doivent être résolus avant leur migration respective.

## Règles de travail

- branche courte `monarque/phase4-*` puis PR vers `main` ;
- CI obligatoire et merge squash ;
- pas de push direct sur `main` ;
- aucun fichier de travail ou artefact local généré dans le dépôt ;
- contrôle partagé obligatoire :
  `tenant actif → membership → entitlement → activation → permission → scope établissement` ;
- chaque décision structurante est documentée avant d'être codée ;
- une phase reste ouverte tant que chaque gate de sa spécification n'est pas
  prouvé, même si une tranche fonctionnelle est déjà utilisable.

## Prochain jalon

La prochaine tranche peut définir puis tester le modèle Prisma CRM, en
réutilisant les permissions gelées. Le modèle Network attend encore la décision
sur l'indexation publique et les quotas éventuels avant migration.

## Risques connus

- la protection server-side de `main` reste indisponible sur le plan GitHub
  privé courant ; la gouvernance compensatoire est donc PR + CI + squash +
  suppression de branche ;
- les opérations Phase 4 déjà présentes dans OpenAPI sont des surfaces
  placeholder et ne constituent pas une preuve de contrat détaillé ;
- les profils publics et la découverte créent une frontière de données
  cross-tenant qui doit rester explicitement limitée aux projections Network ;
- la vérification/trust relève de la plateforme et ne doit jamais être une
  auto-déclaration tenant.

## Règle de clôture

Ce document sera remplacé ou complété par une preuve de clôture uniquement
après exécution complète des gates de
[`64_PHASE4_CRM_NETWORK_EXECUTION_SPEC.md`](64_PHASE4_CRM_NETWORK_EXECUTION_SPEC.md),
avec résultats observés sur le commit fusionné de `main`.
