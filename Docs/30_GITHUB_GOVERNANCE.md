# 30 — Gouvernance GitHub

## Repository

Public par décision intentionnelle du propriétaire; la visibilité publique n'accorde aucun droit de réutilisation. La notice propriétaire existante dans `LICENSE` demeure « draft for legal review » et n'est pas remplacée par une licence open source.

## Main — état cible

- PR obligatoire ;
- PR obligatoire ;
- check `validate-pr / validate` obligatoire ;
- branche à jour avant merge ;
- force push et suppression interdits ;
- application de la règle aux administrateurs.

La protection de branche est activée sur `main` et ne requiert pas d'approbation GitHub, afin de garder le flux possible sans second approbateur. Les revues techniques restent recommandées et les changements normatifs doivent être explicitement examinés; elles ne sont pas un check de fusion configuré côté GitHub.

Le check requis ne doit pas être renommé sans mettre à jour la règle. Les checks propres au workflow main continuent à s'exécuter après fusion.

## Ownership

`CODEOWNERS` impose la revue de `@jupi-z` sur :
- backend ;
- Prisma/migrations ;
- OpenAPI ;
- contrats machine-readable ;
- scripts ;
- CI ;
- documentation normative.

## Collaboration

L'accès de `@Gabby344` permet la contribution au projet mais ne vaut pas transfert de propriété ou participation au capital.

Tant que `main` n'est pas techniquement protégée, `@Gabby344` doit travailler exclusivement par branche et Pull Request.

## Issues

Une issue pour chaque phase, verticale ou bug significatif. Pas de travail important non tracé.

## Branches

- branches courtes ;
- une branche fusionnée ne doit pas rester comme branche de travail active ;
- aucune nouvelle branche longue durée hors décision explicite ;
- les branches obsolètes doivent être supprimées après fusion.

## Commits

Conventional Commits recommandé : `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `security`.

## Releases

Tags SemVer immuables.
