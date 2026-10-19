# Prompt Codex — Monarque FairScale V1 (Phase 9.5 puis 9.6)

Tu interviens sur le dépôt privé **jupi-z/Monarque-Connect**, backend propriétaire NestJS 12 / TypeScript / Prisma 7 / PostgreSQL 17, branche par défaut **main**. La Phase 9 Messaging est terminée, preuves dans Docs/87 et Docs/88. Ne rouvre aucune phase 0–9.

**Mission :** réalise intégralement le chantier **Monarque FairScale V1** en deux phases intermédiaires **9.5** et **9.6**, strictement **avant Phase 10**. Ne te contente ni de plans, ni de mocks présentés comme opérationnels : code, migrations, tests, preuves CI et documentation doivent suivre les normes.

**Avant tout code :** assure-toi que la PR documentaire FairScale issue de la branche `docs/fairscale-v1-phase-9-5-9-6` est fusionnée sur main après CI ; sinon travaille à partir de cette branche puis demande/requiers sa fusion, sans contourner la protection de main. Lire dans cet ordre :
- `Docs/89_FAIRSCALE_V1_NORMATIVE_SPEC.md` — **source de vérité commerciale**
- `Docs/94_ADR_038_FAIRSCALE.md` — décision architecturale
- `Docs/90_PHASE_9_5_FAIRSCALE_CORE_EXECUTION_SPEC.md` — implémentation 9.5
- `Docs/91_PHASE_9_6_FAIRSCALE_BILLING_EXECUTION_SPEC.md` — implémentation 9.6
- `Docs/92_FAIRSCALE_V1_ACCEPTANCE_MATRIX.md` — matrice exhaustive d'acceptation
- `Docs/93_FAIRSCALE_PHASES_STATUS.md` — suivi et preuves
- `Docs/superpowers/plans/2026-10-19-fairscale-v1-9-5-9-6-plan.md` — ordre des PR
- Docs/21, 23, 33, 34, 35, 55, 59 et 87–88 pour les frontières et décisions historiques.

**Commercial V1 figé :** CONNECT gratuit ; OPERATIONS 15 USD/mois ; BUSINESS 45 USD/mois ; ENTERPRISE 180 USD/mois. Première souscription payante mensuelle : -15 % sur les **trois premières échéances mensuelles admissibles**, une seule fois par identité d'entreprise, même si elle recrée un compte ; toute souscription annuelle : -20 % sur le **forfait de base à chaque paiement annuel**, renouvellements compris. Aucune double remise. Aucun supplément par utilisateur interne ni quota commercial MAX_USERS sur les forfaits payants. Capacités V1 : CONNECT 1 établissement/5 membres, OPERATIONS 1 établissement, BUSINESS 3, ENTERPRISE 10 ; add-on site payé et accepté de 10 USD/mois ou 120 USD/an, hors remises du forfait. Les modules/permissions existants restent source de vérité. MANAGED n'est pas un cinquième plan. Toutes les sommes USD au centime, sans float.

**Phase 9.5 / issue #122 :** contract-first OpenAPI, migrations additives et versions USD immuables, price catalog et BillingCustomer, anti-duplication des promotions, pricing quote déterministe, extensions d'établissements et quotas payants sans limites commerciales d'employés ; tests complets et preuves CI, puis fermeture du ticket et mise à jour Docs/93. **Ne passe pas en 9.6 avant la clôture 9.5.**

**Phase 9.6 / issue #123 :** factures et paiements **SaaS de Monarque Group** isolés des factures SALES tenant, checkout, provider-neutral payment adapter, vérification authenticité/amount/currency/transaction, inbox anti-replay, Outbox transactionnelle, activation après paiement, renouvellements, promotions, proratas, changemens mensuel↔annuel, upgrade/downgrade, dunning 7 jours, remboursement/chargeback et résiliation sans supprimer/export bloqué, puis **Control Plane Billing minimal** (sans prétendre clore Phase 11). Tests et CI réels + preuves de clôture.

**Méthode :** PRs courtes, branchées depuis main, pas de push direct. Chaque domaine est API-first et tenant-scoped, RBAC et policies serveur, migrations depuis DB vide et upgrade de la Phase 9, tests intégration PostgreSQL/E2E, cas fraude/rejeu/concurrence, vérification de toutes les lignes Docs/92, lint/typecheck/prisma/openapi/contracts/test/build et CI GitHub PR + post-fusion. Ne jamais présenter une simulation fournisseur comme un vrai paiement ni inventer de conformité légale. Sans fournisseur réel activé, livrer adapter neutre, sandbox prouvée, et **bloquer explicitement le lancement commercial auto** jusqu'à vérification d'un circuit d'encaissement.

**Attendu de chaque tranche :** code fonctionnel, fichier(s) modifié(s), tests/commandes exécutés, SHA et PR/CI, risques et limites, mise à jour de Docs/93. À la fin : démonstration par HTTP du parcours complet et bilan des gates, clôture réelle des issues #122 puis #123. Ensuite seulement, revenir aux Phases 10, 11, 11.5 et 12.

Tu as carte blanche dans les limites des docs normatifs : choisis les détails techniques cohérents et conservateurs, en préservant l'existant. N'interromps le travail que si une vraie dépendance externe non substituable empêche une validation, et laisse alors un blocage précis, vérifiable, sans déclarer la phase achevée.
