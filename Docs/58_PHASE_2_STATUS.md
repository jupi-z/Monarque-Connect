# 58 — Phase 2 Product Entitlements Status

## État

Phase 2 est ouverte en préparation sur `main`. La Phase 1 Identity & Tenancy est clôturée et fournit l'identité, l'isolation, l'autorisation, l'audit et l'Event Fabric nécessaires au Control Plane.

## Première tranche recommandée

1. Catalogue des modules et versions publiées ;
2. plans et versions immuables ;
3. abonnements d'organisation et transitions ;
4. résolution des entitlements effectifs ;
5. projection capabilities versionnée ;
6. quotas et activation des modules.

La spécification normative est [57_PHASE2_PRODUCT_ENTITLEMENTS_EXECUTION_SPEC.md](57_PHASE2_PRODUCT_ENTITLEMENTS_EXECUTION_SPEC.md). Aucune implémentation métier n'est considérée commencée avant la validation de cette spécification et de son plan d'exécution.

## Conditions de travail

- travailler par branche courte et PR obligatoire ;
- conserver `main` protégée par la ruleset GitHub configurée ;
- réutiliser `AuthorizationService`, `PrismaService` et `PrismaOutboxWriter` ;
- ne jamais contourner l'isolation Identity/Tenancy avec un contrôle d'entitlement parallèle.
