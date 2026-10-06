# 30 — Gouvernance GitHub

## Repository
Privé.

## Main
Protection attendue :
- PR obligatoire ;
- au moins 1 approbation ;
- conversations résolues ;
- checks CI obligatoires ;
- branche à jour avant merge ;
- force push interdit ;
- suppression interdite.

## Ownership
`CODEOWNERS` impose la revue de `@jupi-z` sur backend, migrations, OpenAPI et CI.

## Collaboration
L'accès de `@Gabby344` permet la contribution au projet mais ne vaut pas transfert de propriété ou participation au capital.

## Issues
Une issue pour chaque verticale ou bug. Pas de travail important non tracé.

## Branch lifecycle
- branche courte par scope ;
- aucune branche fusionnée ne reste comme branche de travail ;
- supprimer la branche head après merge ;
- activer GitHub **Automatically delete head branches** ;
- ne jamais supprimer `main`.

## Commits
Conventional Commits recommandé : `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `security`.

## Releases
Tags SemVer immuables.
