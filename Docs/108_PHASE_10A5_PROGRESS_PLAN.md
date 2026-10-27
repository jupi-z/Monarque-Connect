# Phase 10A.5 — suivi et progression (modèle)

Le rapport [d'audit C0](115_PHASE_10A5_C0_CODEBASE_AUDIT.md) documente le code examiné à la baseline `main@0df3c09` et ses arbitrages; son addendum enregistre les preuves actuelles. Le cadrage C0 est fusionné au commit `78b91675e26a83e15be1539f7b3cc4f2a058a0b6`; la CI post-fusion a réussi et l'issue #153 est close. C1.1–C1.4 sont livrés selon leurs preuves PR et post-fusion, consignées dans [Docs/117](117_C1_EXECUTION_STATUS.md) et [Docs/118](118_C1_CLOSURE_EVIDENCE.md). C2 est autorisé et suivi dans [Docs/120](120_C2_EXECUTION_STATUS.md); il n'est pas encore déclaré livré. C3–C8 restent hors autorisation actuelle.

**Statut Phase 10A.5 = IN_PROGRESS. C0 = ACCEPTED / CLOSED. C1.1–C1.4 = DONE. C2 = IN_PROGRESS / AUTHORIZED via issue #163. C3–C8 = PLANNED / NOT_STARTED / NOT AUTHORIZED.** Les critères G-01–G-14 restent des gates de livraison future et ne sont pas satisfaits par la clôture de C0/C1.

| Lot | Poids | Dépendances |
|---|---:|---|
| C0 audit/mapping/ADRs | 10 | 10A clôturée |
| C1 product catalog/entitlements | 12 | C0 |
| C2 identity/tenancy/clients | 12 | C0; autorisé, en cours selon Docs/120 |
| C3 prix, catalogue, FX/unités | 12 | C1/C2 |
| C4 Sales/POS/Cash transactionnel | 20 | C2/C3 |
| C5 documents/impression/fiscalité | 10 | C4 |
| C6 AI/events contrats partagés | 8 | C0/C2 |
| C7 façade publique/merchant | 8 | C1–C6 selon endpoint |
| C8 intégration/CI/compatibilité | 8 | toutes |
| **Total** | **100** | |

Chaque lot a tâches atomiques `id, owner, state, criterion, tests, evidence`; progression `sum(weight × accepted_acceptance_criteria / total_acceptance_criteria)` : les tests prouvent les critères, leur quantité n'augmente pas artificiellement l'avancement. Zéro crédit pour `PLANNED, IMPLEMENTED_NOT_TESTED, NOT_RUN, BLOCKED` ; documenter les `EXTERNAL_PENDING` indépendamment du pourcentage technique. Un échec P0 bloque la clôture malgré % élevé. Les preuves de restauration, de charge et RPO/RTO restent des gates d'exploitation C8, pas un prérequis de conformité architecturale C0.

**Protection du projet :** modifications par branche/PR, CI exigées, migrations additives, rollback testé, pas d'altération silencieuse des ADR et contrats pré-10A ; ne pas toucher aux secrets, DNS, production, PSP ni compte commerçant réel sans autorisation.
