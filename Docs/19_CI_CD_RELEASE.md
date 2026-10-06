# 19 — CI/CD et release

## PR checks obligatoires
1. install lockfile ;
2. lint ;
3. typecheck ;
4. unit ;
5. integration ;
6. E2E ;
7. OpenAPI validation ;
8. contract schema validation (domain events / agent proposals) ;
9. migration check ;
10. secret scan ;
11. dependency audit ;
12. build.

## Release
SemVer.  
Tag immuable `vX.Y.Z`.  
Changelog + OpenAPI archivée + migrations + rollback/forward-fix documenté.

`main` est protégée et toujours déployable.

## Release de features IA

Toute feature IA production ajoute à ses gates :
- eval dataset versionné ;
- sécurité prompt injection/tooling ;
- privacy/data-policy review ;
- coût/latence baseline ;
- kill switch ;
- model/provider version enregistrée.
