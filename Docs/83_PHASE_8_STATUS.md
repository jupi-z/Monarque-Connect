# 83 — Phase 8 Projects & Documents — Statut de cadrage

## État actuel

La Phase 8 est officiellement ouverte en cadrage sur
`main@fee4f659bfaf8d2371d9b108b011a7285b75539d`. La PR de cadrage #106, sa
CI PR #282 et sa CI post-fusion #283 sont vertes. L'issue de suivi est
[#105](https://github.com/jupi-z/Monarque-Connect/issues/105).

La Phase 7 est clôturée et n'est pas rouverte. Aucun modèle, migration ou
endpoint métier Phase 8 n'est encore implémenté dans cette tranche.

## Artefacts de cadrage

- [x] spécification normative : `Docs/82_PHASE8_PROJECTS_DOCUMENTS_EXECUTION_SPEC.md` ;
- [x] statut et gates : `Docs/83_PHASE_8_STATUS.md` ;
- [x] plan séquencé : `Docs/superpowers/plans/2026-10-14-phase-8-projects-documents-plan.md` ;
- [x] issue GitHub #105 ;
- [x] contrat OpenAPI initial détaillé et tests de contrat ;
- [x] correction de la mention obsolète de Phase 6 dans la roadmap ;
- [x] PR #106 fusionnée sur `main@fee4f659bfaf8d2371d9b108b011a7285b75539d`,
  CI PR #282 et CI post-fusion #283 : `success` ;
- [ ] migrations et modèles Prisma ;
- [ ] services, contrôleurs et adaptateur binaire ;
- [ ] tests PostgreSQL/E2E et preuves cross-phase ;
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

## Gouvernance

Chaque tranche suivra : branche dédiée → PR → CI verte → fusion contrôlée →
suppression de branche. Aucun push direct sur `main`. La Phase 8 ne sera pas
déclarée terminée sur la seule base du cadrage ou d'une CI de compilation.
