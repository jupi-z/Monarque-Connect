# 19 — CI/CD et release

## Gates actives sur chaque PR

La CI de fondation doit exécuter au minimum :

1. `npm ci` depuis le lockfile ;
2. audit des dépendances de production au niveau `high` ;
3. lint ;
4. typecheck ;
5. validation du schéma Prisma ;
6. génération Prisma ;
7. validation OpenAPI ;
8. validation des contrats machine-readable ;
9. tests unitaires ;
10. build ;
11. smoke HTTP `live` ;
12. smoke HTTP `ready` avec connexion PostgreSQL réelle.

Une PR ne peut être considérée livrable si l'un de ces gates échoue.

## Gates progressives par verticale

Dès qu'une verticale introduit les éléments correspondants, elle doit également ajouter à la CI :

- tests d'intégration PostgreSQL ;
- E2E HTTP ;
- migrations base vide + upgrade ;
- tests de concurrence/idempotence ;
- tests tenant/establishment/entitlement ;
- tests de rollback/forward-fix pertinents.

Ces gates ne sont pas simulés artificiellement avant l'existence de la verticale ; ils deviennent obligatoires avec le code concerné.

## Sécurité CI

Avant release commerciale, la pipeline doit inclure un secret scanner dédié et les contrôles de dépendances définis dans la baseline sécurité. Aucun secret de production n'est injecté dans la CI de validation.

## Main

État cible :
- PR obligatoire ;
- CI obligatoire ;
- revue requise ;
- force-push et suppression interdits.

Si le plan GitHub du dépôt privé ne permet pas encore d'imposer techniquement ces règles, la politique opérationnelle reste **aucun push direct sur `main`** et l'activation de la protection est suivie séparément comme hardening du dépôt.

## Release

SemVer.  
Tag immuable `vX.Y.Z`.  
Changelog + OpenAPI archivée + migrations + rollback/forward-fix documenté.

## Release de features IA

Toute feature IA production ajoute à ses gates :
- dataset d'évaluation versionné ;
- sécurité prompt injection/tooling ;
- privacy/data-policy review ;
- coût/latence baseline ;
- kill switch ;
- model/provider version enregistrée.
