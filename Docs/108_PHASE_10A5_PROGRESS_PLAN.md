# Phase 10A.5 — suivi et progression (modèle)

Le rapport [d'audit C0](115_PHASE_10A5_C0_CODEBASE_AUDIT.md) documente le code au `main@0df3c09` et ses arbitrages. Le cadrage attend fusion et CI post-fusion; C1 est autorisé après ce gate. Aucun lot C1–C8 n'est déclaré livré avant ses propres preuves.

**Statut Phase 10A.5 = IN_PROGRESS. C0 = prêt pour fusion documentaire et vérification post-fusion; C1 = autorisé après ce gate; C2–C8 = PLANNED / NOT_RUN.** Les critères G-01–G-14 restent des gates de livraison future et ne sont pas satisfaits par la documentation C0.

| Lot | Poids | Dépendances |
|---|---:|---|
| C0 audit/mapping/ADRs | 10 | 10A clôturée |
| C1 product catalog/entitlements | 12 | C0 |
| C2 identity/tenancy/clients | 12 | C0 |
| C3 prix, catalogue, FX/unités | 12 | C1/C2 |
| C4 Sales/POS/Cash transactionnel | 20 | C2/C3 |
| C5 documents/impression/fiscalité | 10 | C4 |
| C6 AI/events contrats partagés | 8 | C0/C2 |
| C7 façade publique/merchant | 8 | C1–C6 selon endpoint |
| C8 intégration/CI/compatibilité | 8 | toutes |
| **Total** | **100** | |

Chaque lot a tâches atomiques `id, owner, state, criterion, tests, evidence`; progression `sum(weight × accepted_acceptance_criteria / total_acceptance_criteria)` : les tests prouvent les critères, leur quantité n'augmente pas artificiellement l'avancement. Zéro crédit pour `PLANNED, IMPLEMENTED_NOT_TESTED, NOT_RUN, BLOCKED` ; documenter les `EXTERNAL_PENDING` indépendamment du pourcentage technique. Un échec P0 bloque la clôture malgré % élevé. Les preuves de restauration, de charge et RPO/RTO restent des gates d'exploitation C8, pas un prérequis de conformité architecturale C0.

**Protection du projet :** modifications par branche/PR, CI exigées, migrations additives, rollback testé, pas d'altération silencieuse des ADR et contrats pré-10A ; ne pas toucher aux secrets, DNS, production, PSP ni compte commerçant réel sans autorisation.
