# 61 — Phase 3 Référentiels — Statut

## État

La Phase 3 — Référentiels est **terminée et clôturée à 100 %** sur `main`.
L'issue de suivi [#43](https://github.com/jupi-z/Monarque-Connect/issues/43) a
été livrée par les PR [#45](https://github.com/jupi-z/Monarque-Connect/pull/45),
[#46](https://github.com/jupi-z/Monarque-Connect/pull/46) et la PR de clôture
documentaire. La Phase 2 constitue la baseline fonctionnelle et normative.

Le périmètre est défini par
[`60_PHASE3_REFERENTIALS_EXECUTION_SPEC.md`](60_PHASE3_REFERENTIALS_EXECUTION_SPEC.md)
et son exécution est tracée dans
[`superpowers/plans/2026-10-12-phase-3-referentials-plan.md`](superpowers/plans/2026-10-12-phase-3-referentials-plan.md).
Les preuves reproductibles sont regroupées dans
[`62_PHASE_3_CLOSURE_EVIDENCE.md`](62_PHASE_3_CLOSURE_EVIDENCE.md).

**Progression : 100 % — implémentation, preuves, revue, CI, merge et nettoyage terminés.**

## Périmètre livré

- [x] Business parties tenant-scoped : CRUD, pagination, filtres, états soft et événements lifecycle ;
- [x] items du catalogue métier : produits/services, SKU normalisé unique et prix décimal sérialisé ;
- [x] warehouses établissement-scoped : CRUD, codes uniques et scope de membership ;
- [x] permissions, entitlements, activations et scopes appliqués côté serveur ;
- [x] migration PostgreSQL additive, audit et Outbox transactionnels ;
- [x] contrats OpenAPI détaillés et validation des contrats ;
- [x] tests PostgreSQL HTTP d'isolation, refus d'entitlement, refus de rôle, scope, concurrence et idempotence ;
- [x] CI GitHub verte, PR revues et merges squash ;
- [x] branches de livraison supprimées après merge et tracker synchronisé.

## Preuves de livraison

| Gate | Preuve | État |
|---|---|---|
| Migration base vide | `prisma:phase3:migration-proof` : 14 migrations appliquées | [x] |
| Upgrade depuis Phase 2 | même preuve : 13 migrations Phase 2 puis 1 migration Phase 3 | [x] |
| Parties | PR #45, tests HTTP PostgreSQL, audit et Outbox | [x] |
| Catalogue | PR #46, tests produits/services, SKU et décimaux | [x] |
| Warehouses | PR #46, tests parent tenant, scope sélectionné et codes | [x] |
| Isolation et scopes | parties inter-tenant ; warehouses hors scope refusés en lecture/écriture | [x] |
| Audit et Outbox | mutations et transitions auditées atomiquement ; répétitions sans doublon | [x] |
| Concurrence | PostgreSQL arbitre les doublons SKU et code warehouse : un succès, un conflit | [x] |
| OpenAPI/contrats | OpenAPI validé à 99 opérations et contrats domaine validés | [x] |
| CI et clôture GitHub | Backend CI #158 verte ; PR squash mergées ; issue/tracker synchronisés | [x] |

## Règle de passage

La phase est fermée. Les endpoints CRM, ventes, achats, mouvements de stock,
réseau et intelligence restent hors périmètre et commencent dans les phases
suivantes avec le même contrôle partagé : tenant actif → membership →
entitlement → activation → permission → scope établissement.
