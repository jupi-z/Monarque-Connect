# 61 — Phase 3 Référentiels — Statut

## État

La Phase 3 est **ouverte** par l'issue GitHub [#43](https://github.com/jupi-z/Monarque-Connect/issues/43).
La Phase 2 reste la baseline fonctionnelle et normative sur `main`.

Le périmètre de cette phase est défini par
[`60_PHASE3_REFERENTIALS_EXECUTION_SPEC.md`](60_PHASE3_REFERENTIALS_EXECUTION_SPEC.md)
et son exécution est découpée dans
[`superpowers/plans/2026-10-12-phase-3-referentials-plan.md`](superpowers/plans/2026-10-12-phase-3-referentials-plan.md).

**Progression : 0 % — préparation documentaire uniquement.**

## Périmètre

- [ ] Business parties tenant-scoped ;
- [ ] items du catalogue métier ;
- [ ] warehouses établissement-scoped ;
- [ ] permissions, entitlements, activations et scopes appliqués côté serveur ;
- [ ] migrations PostgreSQL, audit et Outbox ;
- [ ] contrats OpenAPI et preuves HTTP ;
- [ ] tests d'isolation, concurrence et idempotence ;
- [ ] CI, revue PR, merge et nettoyage de branche ;
- [ ] preuve de clôture et tracker synchronisés.

## Décisions de démarrage

- Le travail commence depuis `main` après la clôture stricte Phase 2.
- Chaque tranche passe par branche courte, PR, CI, revue et squash merge.
- Les parties utilisent le module `CRM`, les items `CATALOG` et les warehouses
  `INVENTORY`.
- Les désactivations sont non destructives ; les workflows transactionnels et
  les mouvements de stock restent hors périmètre.
- Aucun endpoint métier ne réimplémente l'autorisation : les services réutilisent
  les primitives tenancy/entitlement existantes.

## Journal de preuve

À compléter au fil des PR :

| Gate | Preuve | État |
|---|---|---|
| Migration base vide | À produire | [ ] |
| Upgrade depuis Phase 2 | À produire | [ ] |
| Parties | PR/CI à produire | [ ] |
| Catalogue | PR/CI à produire | [ ] |
| Warehouses | PR/CI à produire | [ ] |
| Isolation et scopes | Tests à produire | [ ] |
| Audit et Outbox | Tests à produire | [ ] |
| OpenAPI/contrats | Validation à produire | [ ] |
| Clôture GitHub | Issue/PR à produire | [ ] |

La phase reste ouverte tant que toutes les cases n'ont pas une preuve
reproductible et versionnée.
