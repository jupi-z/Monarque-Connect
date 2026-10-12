# 58 — Phase 2 Product Entitlements Status

## État

Phase 2 est **clôturée à 100 %** sur `main`. Ses tranches sont intégrées via les PR #28, #30, #32, #33 et #34, et la clôture stricte est documentée dans [59_PHASE_2_CLOSURE_EVIDENCE.md](59_PHASE_2_CLOSURE_EVIDENCE.md). La Phase 1 Identity & Tenancy fournit l'identité, l'isolation, l'autorisation, l'audit et l'Event Fabric nécessaires au Control Plane.

## Tranches livrées

1. Catalogue des modules et versions publiées ;
2. plans et versions immuables ;
3. abonnements d'organisation et transitions ;
4. résolution des entitlements effectifs ;
5. projection capabilities versionnée ;
6. quotas et activation des modules.

La spécification normative est [57_PHASE2_PRODUCT_ENTITLEMENTS_EXECUTION_SPEC.md](57_PHASE2_PRODUCT_ENTITLEMENTS_EXECUTION_SPEC.md). Le plan d'exécution est [2026-10-11-phase-2-product-entitlements-plan.md](superpowers/plans/2026-10-11-phase-2-product-entitlements-plan.md).

## Checklist de livraison

- [x] Modèle Prisma du catalogue canonique (modules core et commerciaux) ;
- [x] Plans et versions avec devise, période, modules inclus et limites initiales ;
- [x] Migration PostgreSQL depuis la baseline Phase 1 ;
- [x] Seed de référence idempotent ;
- [x] Immutabilité SQL des versions actives et de leurs modules/quotas ;
- [x] Tests d'intégration seed idempotent et versionnement ;
- [x] Suite complète, build, lint, OpenAPI et contrats vérifiés localement ;
- [x] Modèle d'abonnement avec historique, fenêtre UTC et états de cycle de vie ;
- [x] Résolution déterministe de l'abonnement effectif aux bornes de dates ;
- [x] Transitions autorisées, transitions terminales et répétitions idempotentes ;
- [x] Audit et événements Outbox transactionnels pour création et transition ;
- [x] Seed de référence robuste face aux invocations concurrentes ;
- [x] Revue PR, CI GitHub et squash merge de la tranche catalogue/plans sur `main` (commit `030e3bd`) ;
- [x] Revue PR, CI GitHub et squash merge de la tranche abonnements sur `main` (commit `ecf0a06`).
- [x] Resolver effectif déterministe : catalogue persistant, abonnement, plan inclus, core, dépendances et raisons de refus ;
- [x] Projection capabilities versionnée branchée sur l'endpoint tenant, sans autorisation implicite par tableau vide ;
- [x] Tests d'intégration PostgreSQL : plan inclus, absence/inactivité d'abonnement, dépendances manquantes ;
- [x] Contrat OpenAPI détaillé pour la version de capabilities, plan, abonnement et projection de modules.
- [x] Activations organisationnelles explicites et persistées, séparées de l'entitlement commercial ;
- [x] Endpoint GET/PATCH modules avec permission tenant, refus des modules core, transitions idempotentes et raisons obligatoires ;
- [x] Audit et Outbox transactionnels pour chaque changement effectif d'activation ;
- [x] Tests d'intégration de désactivation, dépendances, idempotence et isolation par membership ;
- [x] Contrat OpenAPI des modules et transitions d'activation.
- [x] Définitions de quotas héritées des versions de plans actifs ;
- [x] Usages organisationnels par période avec réservations et ledger persistants ;
- [x] Réservations atomiques PostgreSQL avec limite `used + reserved`, sûres sous concurrence ;
- [x] Commit/libération idempotents, invariants d'état et idempotency keys ;
- [x] Audit et événements Outbox transactionnels pour réservation, commit et libération ;
- [x] Endpoint GET quotas avec valeurs BigInt sérialisées explicitement en chaînes JSON ;
- [x] Tests PostgreSQL de concurrence, capacité, idempotence, commit/libération et isolation tenant ;
- [x] Contrat OpenAPI quotas validé et suite complète vérifiée (65 tests).

## Clôture stricte

- [x] preuve automatisée de migration depuis une base vide ;
- [x] preuve automatisée d'upgrade depuis la baseline Phase 1 ;
- [x] E2E HTTP des endpoints modules, activation et quotas ;
- [x] documentation normative, statut, roadmap et baseline de seeds synchronisés ;
- [x] PR #35 revue, CI #138 verte, squash merge et branches de travail supprimées.

## Conditions de travail

- travailler par branche courte et PR obligatoire ;
- conserver `main` protégée par la ruleset GitHub configurée ;
- réutiliser `AuthorizationService`, `PrismaService` et `PrismaOutboxWriter` ;
- ne jamais contourner l'isolation Identity/Tenancy avec un contrôle d'entitlement parallèle.
