# 85 — Phase 8 Documents — Preuve de stabilisation corrective

## Périmètre

Cette preuve couvre uniquement le durcissement post-clôture demandé par
l'[issue #111](https://github.com/jupi-z/Monarque-Connect/issues/111). Elle ne
modifie pas les modèles métier des Phases 0 à 7 et ne constitue pas l'ouverture
de la Phase 9.

Baseline de travail : `main@d862f2a5dff058d4b81e3c93ed018093ee6dca95`.
Branche dédiée : `monarque/phase8-documents-hardening` (supprimée après fusion).

## Corrections livrées

- `StorageAdapter` reçoit réellement les octets via un flux binaire ; l'adaptateur
  calcule la taille et le SHA-256 effectifs avant `complete`.
- Un upload incomplet, un checksum divergent, une taille divergente ou un rejeu
  avec un contenu différent reste refusé. La restitution est exacte.
- Le token et l'expiration de session sont conservés pour les retries ; les
  secrets de stockage ne sont jamais sérialisés dans les réponses métier.
- `MemoryStorageAdapter` est limité aux environnements `test` et `development`;
  les environnements `staging` et `production` exigent un adaptateur réel et ne
  peuvent pas fabriquer un document disponible avec le provider de démonstration.
- Les lectures, listes et téléchargements vérifient les droits de lecture,
  l'entitlement et le scope établissement de chaque cible liée. La création
  d'un lien vérifie également que l'acteur peut lire la cible.
- La validation transactionnelle précède toute finalisation de stockage et la
  révocation persiste d'abord l'état interdit d'accès ; les retries de nettoyage
  restent rejouables.

## État des preuves

Au moment de la création de ce document, les contrôles locaux suivants sont
verts : tests unitaires ciblés Documents/Projects, `typecheck`, `lint`, `build`,
`openapi:validate` (167 opérations) et `contracts:validate`.

Les tests PostgreSQL et HTTP E2E ont été validés par les deux exécutions GitHub
Actions ci-dessous avec le service PostgreSQL 17. L'environnement local ne
disposait pas de Docker ; aucune réussite locale n'a été inventée.

- [CI PR #301](https://github.com/jupi-z/Monarque-Connect/actions/runs/38642938748)
  — `success` sur le head `5c92ccc84dc0a223885b93524a26092e3d949085` ;
- [CI post-fusion #302](https://github.com/jupi-z/Monarque-Connect/actions/runs/38643600297)
  — `success` sur `main@8182fee066b4be516170d6356a71e472729cb1fd`.

Les deux exécutions valident lint, typecheck, validation Prisma, migrations
vides et upgrades Phases 1–7, déploiement Prisma, OpenAPI, contrats, suite
Vitest, suite HTTP E2E, build et smoke HTTP.

## Provenance finale

- PR corrective : [#112](https://github.com/jupi-z/Monarque-Connect/pull/112),
  fusion squashée ;
- head de la PR : `5c92ccc84dc0a223885b93524a26092e3d949085` ;
- SHA final `main` :
  `8182fee066b4be516170d6356a71e472729cb1fd` ;
- issue de suivi : [#111](https://github.com/jupi-z/Monarque-Connect/issues/111) ;
- branche distante de travail : supprimée après fusion contrôlée.

La PR #112 ne modifie aucun domaine métier antérieur : la migration est
additive, les preuves historiques sont conservées et la politique de stockage
réel reste fail-closed tant qu'un provider non mémoire n'est pas configuré.

La Phase 9 reste hors périmètre de cette stabilisation.
