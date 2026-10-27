# Phase 10A.5 — suivi et progression (modèle)

Le rapport [d'audit C0 de la baseline](115_PHASE_10A5_C0_CODEBASE_AUDIT.md) documente l'audit du code au `main@0df3c093`; le gate reste `NOT_ACCEPTED`. Le cadrage/documentation est en cours, mais aucun lot fonctionnel C1–C8 n'a commencé.

**Statut Phase 10A.5 = IN_PROGRESS (cadrage C0), progression des critères acceptés = 0 %. C0 audit réalisé, gate NOT_ACCEPTED. C1–C8 = PLANNED / NOT_RUN.** Les critères G-01–G-14 restent soumis à [Docs/114](114_PHASE_10A5_BOUNDARY_INVARIANTS.md) ; une CI de baseline ou un audit écrit ne transforme pas les critères futurs en PASS.

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

Chaque lot a tâches atomiques `id, owner, state, criterion, tests, evidence`; progression `sum(weight × accepted_acceptance_criteria / total_acceptance_criteria)` : les tests prouvent les critères, leur quantité n'augmente pas artificiellement l'avancement. Zéro crédit pour `PLANNED, IMPLEMENTED_NOT_TESTED, NOT_RUN, BLOCKED` ; documenter les `EXTERNAL_PENDING` indépendamment du pourcentage technique. Un échec P0 bloque la clôture malgré % élevé. Écrire `Docs/10A5_EXECUTION_REPORT.md` et un manifest `Docs/10A5_PROGRESS.json` **seulement au démarrage Codex**, ne pas déclarer accomplis ces travaux de planification.

**Protection du projet :** modifications par branche/PR, CI exigées, migrations additives, rollback testé, pas d'altération silencieuse des ADR et contrats pré-10A ; ne pas toucher aux secrets, DNS, production, PSP ni compte commerçant réel sans autorisation.
