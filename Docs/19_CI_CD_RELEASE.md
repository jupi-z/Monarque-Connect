# 19 — CI/CD et release

## Checks obligatoires dès la fondation

Chaque PR backend doit au minimum passer :

1. installation via lockfile ;
2. Prisma generate ;
3. Prisma schema validation ;
4. lint ;
5. typecheck ;
6. OpenAPI validation ;
7. contract schema validation ;
8. unit tests ;
9. dependency audit niveau high ;
10. build ;
11. smoke HTTP live/ready avec PostgreSQL réel.

## Checks ajoutés dès que le domaine existe

Les contrôles suivants deviennent obligatoires dans la même phase qui introduit les artefacts correspondants :

- integration tests PostgreSQL ;
- E2E HTTP ;
- migrations depuis base vide ;
- upgrade depuis version précédente ;
- tests concurrence/idempotence ;
- secret scanning dédié ;
- security scans adaptés ;
- performance baseline pour les parcours critiques.

Ils ne doivent pas être simulés par des checks vides.

## Gate avant release commerciale

Tous les contrôles applicables ci-dessus doivent être actifs, ainsi que :

- backup/restore prouvé ;
- staging reproductible ;
- rollback/forward-fix documenté ;
- aucune vulnérabilité high/critical connue sans acceptation explicite ;
- protection de `main` active ;
- tag SemVer immuable ;
- changelog ;
- OpenAPI archivée avec la release.

## Release

SemVer.  
Tag immuable `vX.Y.Z`.  
Changelog + OpenAPI + migrations + stratégie de retour documentés.

`main` doit rester protégée et déployable.

## Release de features IA

Toute feature IA production ajoute :

- eval dataset versionné ;
- sécurité prompt injection/tooling ;
- privacy/data-policy review ;
- coût/latence baseline ;
- kill switch ;
- model/provider version enregistrée.
