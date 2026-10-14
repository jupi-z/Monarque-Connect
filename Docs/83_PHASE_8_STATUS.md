# 83 — Phase 8 Projects & Documents — Statut de cadrage

## État actuel

La Phase 8 est officiellement ouverte sur la baseline
`main@318b3e5da5ddf257355b2d87d40cdcc5af8f571b`. La PR de cadrage #106, sa
CI PR #282 et sa CI post-fusion #283 sont vertes. L'issue de suivi est
[#105](https://github.com/jupi-z/Monarque-Connect/issues/105).

La Phase 7 est clôturée et n'est pas rouverte. L'implémentation Phase 8 est en
cours sur la branche dédiée `monarque/phase8-implementation`, sans modification
directe de `main`. Les commits d'implémentation déjà réalisés sont :

- `8966f42` — modèles Prisma et migration additive Projects/Documents ;
- `4da65aa` — autorisations et transitions centralisées ;
- `7e6f4b8` — services et contrôleurs Projects/Tasks transactionnels ;
- `b02d8b4` — documents, liens, adaptateur binaire, événements, preuves et E2E.

## Artefacts de cadrage

- [x] spécification normative : `Docs/82_PHASE8_PROJECTS_DOCUMENTS_EXECUTION_SPEC.md` ;
- [x] statut et gates : `Docs/83_PHASE_8_STATUS.md` ;
- [x] plan séquencé : `Docs/superpowers/plans/2026-10-14-phase-8-projects-documents-plan.md` ;
- [x] issue GitHub #105 ;
- [x] contrat OpenAPI initial détaillé et tests de contrat ;
- [x] correction de la mention obsolète de Phase 6 dans la roadmap ;
- [x] PR #106 fusionnée sur `main@fee4f659bfaf8d2371d9b108b011a7285b75539d`,
  CI PR #282 et CI post-fusion #283 : `success` ;
- [x] migrations et modèles Prisma ;
- [x] services, contrôleurs et adaptateur binaire ;
- [x] tests PostgreSQL/E2E et preuves cross-phase ajoutés au dépôt ;
- [ ] PR d'implémentation et CI post-fusion ;
- [ ] clôture stricte Phase 8.

## Gates de sortie

- [ ] Projects/Tasks établissement-scopés, transitions atomiques et auditables ;
- [ ] Documents/links tenant-scoped, cibles allowlistées et sans fuite ;
- [ ] entitlement, permissions et scopes centralisés ;
- [ ] idempotence canonique, concurrence et refus `409` démontrés ;
- [ ] stockage binaire derrière un adaptateur, sans accès client direct ;
- [ ] événements et Outbox atomiques, consumers rejouables ;
- [ ] migrations base vide et upgrade depuis Phase 7 ;
- [ ] tests PostgreSQL, E2E, OpenAPI, contrats, build et non-régression ;
- [ ] CI PR et post-merge vertes ;
- [ ] preuve, roadmap, tracker et issue synchronisés.

## Vérifications locales de la tranche

Les contrôles suivants passent localement sur la branche : `typecheck`, `lint`,
`build`, `prisma:validate`, `openapi:validate`, `contracts:validate` et les
tests unitaires/contrats/adaptateur ciblés. Les tests PostgreSQL et E2E n'ont
pas pu être exécutés dans cet environnement le 14 octobre 2026 : Docker
Desktop n'est pas démarré et PostgreSQL refuse les connexions sur
`127.0.0.1:5432` et `::1:5432`. Ils restent obligatoires et seront attestés
par la CI de la PR avant toute fusion.

## Gouvernance

Chaque tranche suivra : branche dédiée → PR → CI verte → fusion contrôlée →
suppression de branche. Aucun push direct sur `main`. La Phase 8 ne sera pas
déclarée terminée sur la seule base du cadrage ou d'une CI de compilation.
