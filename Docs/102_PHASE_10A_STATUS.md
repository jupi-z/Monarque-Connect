# 102 — Statut Phase 10A : Intelligence déterministe

**État : ouverte — cadrage normatif fusionné ; routes et contrats HTTP en livraison incrémentale, projections métier non disponibles.**
**Baseline :** `main@26cf9c5e71d83674c2c8954f7c3eda00874293ea` (vérifiée le 20/10/2026).  
**Spécification :** [Docs/101](101_PHASE_10A_INTELLIGENCE_EXECUTION_SPEC.md).  
**Plan :** [plan d’exécution Phase 10A](superpowers/plans/2026-10-20-phase-10a-intelligence.md).  
**Suivi GitHub :** [issue Phase 10A #141](https://github.com/jupi-z/Monarque-Connect/issues/141) ; [tracker global #11](https://github.com/jupi-z/Monarque-Connect/issues/11).

## Périmètre

Livrer les KPI déterministes et versionnés, leurs projections reconstruisibles depuis les domaines sources, deux règles d’alertes explicables (`INVOICE_OVERDUE`, `PROJECT_OVERDUE`) et les API tenant-scoped de dashboard, métriques et alertes. Les sources métier restent autoritaires. Aucun modèle IA, système probabiliste, frontend, broker ni modification rétroactive des invariants des Phases 0–9 n’est inclus.

## Gates d’acceptation

- [ ] Contrats OpenAPI et permissions gelés et validés avant migration.
- [ ] Modèles/migration additifs validés depuis base vide et upgrade depuis Phase 9.6.
- [ ] Tous les 11 KPI couverts par tests exacts : états, périodes UTC, devises, unités, paiements inversés et scopes.
- [ ] Consommation au moins une fois, rejeu, concurrence, reconstruction et réconciliation prouvés sur PostgreSQL.
- [ ] Tests HTTP positifs/négatifs couvrant tenant, membership, entitlement, module source, permission et établissement.
- [ ] OpenAPI, lint, typecheck, tests, E2E, migrations, build et smoke validés dans GitHub Actions sur chaque PR.
- [ ] CI post-fusion `main` vérifiée et preuves datées/liées avant clôture.

## État des lots

| Lot | État |
|---|---|
| Spécification normative et matrice d’autorisations | Acceptées dans Docs/101 |
| Contrats HTTP détaillés | Dashboard et métriques actifs avec contrôle des permissions sources et scopes ; alertes prévues à la tâche 7 |
| Schéma et migrations | À faire |
| Registre et calculs KPI | À faire |
| Consumers, rebuild et alertes | À faire |
| API, isolation et E2E | À faire |
| CI et preuves post-fusion | À faire |

Les paiements réels et la conformité de FairScale restent des dépendances externes de commercialisation suivies dans l’issue [#123](https://github.com/jupi-z/Monarque-Connect/issues/123), mais ne bloquent pas les fonctionnalités déterministes de Phase 10A.

## Gouvernance

Chaque lot est réalisé sur une branche dédiée, en PR, avec les contrôles obligatoires verts avant fusion. Aucun push direct sur `main`. Le statut restera ouvert tant que toutes les preuves des gates ne sont pas effectives ; les tests locaux ne seront jamais présentés comme des exécutions CI GitHub.
