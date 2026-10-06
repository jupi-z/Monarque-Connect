# 19 — CI/CD et release

## PR checks obligatoires
1. install lockfile ;
2. lint ;
3. typecheck ;
4. unit ;
5. integration ;
6. E2E ;
7. OpenAPI validation ;
8. migration check ;
9. secret scan ;
10. dependency audit ;
11. build.

## Release
SemVer.  
Tag immuable `vX.Y.Z`.  
Changelog + OpenAPI archivée + migrations + rollback/forward-fix documenté.

`main` est protégée et toujours déployable.
