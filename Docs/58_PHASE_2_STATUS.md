# 58 — Phase 2 Product Entitlements Status

## État

Phase 2 est ouverte et sa première tranche est intégrée sur `main` via la PR #28. La Phase 1 Identity & Tenancy est clôturée et fournit l'identité, l'isolation, l'autorisation, l'audit et l'Event Fabric nécessaires au Control Plane.

## Première tranche recommandée

1. Catalogue des modules et versions publiées ;
2. plans et versions immuables ;
3. abonnements d'organisation et transitions ;
4. résolution des entitlements effectifs ;
5. projection capabilities versionnée ;
6. quotas et activation des modules.

La spécification normative est [57_PHASE2_PRODUCT_ENTITLEMENTS_EXECUTION_SPEC.md](57_PHASE2_PRODUCT_ENTITLEMENTS_EXECUTION_SPEC.md). Le plan d'exécution est [2026-10-11-phase-2-product-entitlements-plan.md](superpowers/plans/2026-10-11-phase-2-product-entitlements-plan.md).

## Avancement de la première tranche

- [x] Modèle Prisma du catalogue canonique (modules core et commerciaux) ;
- [x] Plans et versions avec devise, période, modules inclus et limites initiales ;
- [x] Migration PostgreSQL depuis la baseline Phase 1 ;
- [x] Seed de référence idempotent ;
- [x] Immutabilité SQL des versions actives et de leurs modules/quotas ;
- [x] Tests d'intégration seed idempotent et versionnement ;
- [x] Suite complète, build, lint, OpenAPI et contrats vérifiés localement ;
- [x] Revue PR, CI GitHub et squash merge sur `main` (commit `030e3bd`).

## Conditions de travail

- travailler par branche courte et PR obligatoire ;
- conserver `main` protégée par la ruleset GitHub configurée ;
- réutiliser `AuthorizationService`, `PrismaService` et `PrismaOutboxWriter` ;
- ne jamais contourner l'isolation Identity/Tenancy avec un contrôle d'entitlement parallèle.
