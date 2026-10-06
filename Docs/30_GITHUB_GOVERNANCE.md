# 30 — Gouvernance GitHub

## Repository

Privé.

## Main — état cible

- PR obligatoire ;
- au moins 1 approbation ;
- conversations résolues ;
- Backend CI obligatoire ;
- branche à jour avant merge ;
- force push interdit ;
- suppression interdite.

L'activation technique dépend des fonctions disponibles sur le plan GitHub du dépôt privé. Tant que la protection n'est pas effectivement activée, la règle opérationnelle est stricte : **aucun contributeur ne pousse directement sur `main`; toute contribution passe par branche + PR + CI verte + revue de `@jupi-z`.**

L'état technique courant de cette protection est suivi dans l'issue `#6`.

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
