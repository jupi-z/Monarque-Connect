# Phase 10A.5 — suivi et progression (modèle)

**Statut initial = PLANNED, progression technique vérifiée = 0 %.**

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

Chaque lot a tâches atomiques `id, owner, state, criterion, tests, evidence`; progression `sum(weight × verified_tests / total_tests)`, avec zéro crédit pour `PLANNED, IMPLEMENTED_NOT_TESTED, NOT_RUN, BLOCKED`. Un échec P0 bloque la clôture malgré % élevé. Écrire `Docs/10A5_EXECUTION_REPORT.md` et un manifest `Docs/10A5_PROGRESS.json` **seulement au démarrage Codex**, ne pas déclarer accomplis ces travaux de planification.

**Protection du projet :** modifications par branche/PR, CI exigées, migrations additives, rollback testé, pas d'altération silencieuse des ADR et contrats pré-10A ; ne pas toucher aux secrets, DNS, production, PSP ni compte commerçant réel sans autorisation.
