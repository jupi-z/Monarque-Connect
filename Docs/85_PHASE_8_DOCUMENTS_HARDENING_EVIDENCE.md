# 85 — Phase 8 Documents — Preuve de stabilisation corrective

## Périmètre

Cette preuve couvre uniquement le durcissement post-clôture demandé par
l'[issue #111](https://github.com/jupi-z/Monarque-Connect/issues/111). Elle ne
modifie pas les modèles métier des Phases 0 à 7 et ne constitue pas l'ouverture
de la Phase 9.

Baseline de travail : `main@d862f2a5dff058d4b81e3c93ed018093ee6dca95`.
Branche dédiée : `monarque/phase8-documents-hardening`.

## Corrections prévues

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

Les tests PostgreSQL et HTTP E2E nécessitent le service PostgreSQL de la CI ou
un environnement local équivalent. Ils ne sont pas déclarés réussis tant qu'une
exécution GitHub Actions de la PR corrective et une exécution post-fusion ne les
ont pas effectivement validés.

## Provenance à compléter après fusion

- PR corrective : à renseigner après création ;
- CI PR : URL et conclusions des jobs à renseigner ;
- CI post-fusion : URL et conclusions des jobs à renseigner ;
- SHA final `main` : à renseigner après fusion ;
- branche distante de travail : à supprimer après fusion contrôlée.

La Phase 9 reste hors périmètre de cette stabilisation.
