# 83 — Phase 8 Projects & Documents — Statut et stabilisation

## État actuel

La livraison fonctionnelle initiale reste historique et n'est pas réouverte.
L'audit post-clôture a toutefois identifié des écarts de durcissement sur le
transport binaire, l'autorisation des cibles liées et l'ordre des mutations de
stockage. La clôture stricte de la Phase 8 reste suspendue jusqu'à la validation
de la PR corrective suivie par [#111](https://github.com/jupi-z/Monarque-Connect/issues/111).

La Phase 8 a été officiellement ouverte sur la baseline
`main@318b3e5da5ddf257355b2d87d40cdcc5af8f571b`. La PR de cadrage #106, sa
CI PR #282 et sa CI post-fusion #283 étaient vertes. L'issue de suivi est
[#105](https://github.com/jupi-z/Monarque-Connect/issues/105).

La Phase 7 est clôturée et n'est pas rouverte. L'implémentation Phase 8 a été
réalisée sur la branche dédiée `monarque/phase8-implementation`, sans
modification directe de `main`. Les commits d'implémentation ont été fusionnés
par la PR #108 :

- `8966f42` — modèles Prisma et migration additive Projects/Documents ;
- `4da65aa` — autorisations et transitions centralisées ;
- `7e6f4b8` — services et contrôleurs Projects/Tasks transactionnels ;
- `b02d8b4` — documents, liens, adaptateur binaire, événements, preuves et E2E.
- `19a4328` — correctifs finaux de rejeu BigInt, liens persistés et preuves de
  migration compatibles PostgreSQL.

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
- [x] PR d'implémentation #108 fusionnée par squash dans
  `main@6105806790994f98f8fa33ace520a412bebbd05b` ;
- [x] CI PR #291 et CI post-fusion #292 : `success` ;
- [x] CI PR documentaire #293 et CI finale de `main` #294 : `success` ;
- [x] clôture stricte Phase 8, documentée dans
  `Docs/84_PHASE_8_CLOSURE_EVIDENCE.md`.

## Gates de sortie

- [x] Projects/Tasks établissement-scopés, transitions atomiques et auditables ;
- [x] Documents/links tenant-scoped, cibles allowlistées et sans fuite ;
- [x] entitlement, permissions et scopes centralisés ;
- [x] idempotence canonique, concurrence et refus `409` démontrés ;
- [x] stockage binaire derrière un adaptateur, sans accès client direct ;
- [x] événements et Outbox atomiques, consumers rejouables ;
- [x] migrations base vide et upgrade depuis Phase 7 ;
- [x] tests PostgreSQL, E2E, OpenAPI, contrats, build et non-régression ;
- [x] CI PR et post-merge vertes ;
- [x] preuve, roadmap, tracker et issue synchronisés.

## Gates de stabilisation corrective — issue #111

- [ ] transfert binaire réel via `StorageAdapter`, taille et SHA-256 vérifiés ;
- [ ] restitution exacte et rejeu divergent refusé ;
- [ ] token de session opaque et expiration conservés pour les retries ;
- [ ] adaptateur mémoire refusé en environnement réel ;
- [ ] permissions, entitlements et scopes de la cible appliqués aux lectures,
  listes, liens et téléchargements ;
- [ ] `complete` et `revoke` n'effectuent pas de mutation prématurée de
  l'adaptateur ;
- [ ] preuves PostgreSQL, HTTP E2E, sécurité, migrations et CI PR/post-merge.

## Vérifications locales de la tranche

Les contrôles statiques ciblés (`typecheck`, `lint`, `build`,
`prisma:validate`, `openapi:validate`, `contracts:validate`) et les tests
unitaires ciblés ont été exécutés sur la branche corrective. Les tests
PostgreSQL et E2E ont été exécutés avec succès par la CI GitHub, qui fournit
la preuve reproductible avec PostgreSQL 17. Le détail des résultats et leurs
URLs de la livraison initiale est conservé dans
`Docs/84_PHASE_8_CLOSURE_EVIDENCE.md`; les résultats de la stabilisation seront
ajoutés dans `Docs/85_PHASE_8_DOCUMENTS_HARDENING_EVIDENCE.md` après fusion.

## Gouvernance

La tranche a suivi : branche dédiée → PR #108 → CI verte → fusion contrôlée par
squash → suppression de branche. Aucun push direct sur `main`. Toute évolution
ultérieure de la Phase 8 devra préserver cette gouvernance et ne constitue pas
une réouverture de la phase clôturée.
