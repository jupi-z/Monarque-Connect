# Plan d'exécution — Monarque FairScale V1 (Phases 9.5 et 9.6)

## Source de vérité
Docs/89 (norme), Docs/94 (ADR), Docs/90 (Phase 9.5), Docs/91 (Phase 9.6), Docs/92 (tests), Docs/93 (statut). Baseline Phase 9 close : main@becef9a96163b2331e1d459583d6dde551857c73.

## Règles Codex
1. Partir de la dernière main après fusion de la PR documentaire ; ne jamais pousser directement sur main.
2. Ne pas demander de clarifications pour décisions déjà figées dans Docs/89 ; seuls blocages externes (provider live/taxes) peuvent rester explicitement notés.
3. Ouvrir PRs petites, contract-first ; lint/typecheck/prisma generate + validate, PostgreSQL integrations, migrations from empty + upgrade, OpenAPI, E2E, build et CI post-fusion. Ne pas fermer Phase 9.5 ou 9.6 sans preuve.
4. Ne pas rouvrir Phase 9 ni refactor massif des phases 0-9 ; migrations additives, versions de plans historiques conservées.
5. FairScale est plateforme B2B SaaS : ne pas confondre BILLING plateforme et SALES tenant ; préserver isolation et scopes.

## Ordre PR cible

### Phase 9.5
- PR-9.5-A : tracé contract-first, schema/ADR additionnels, DTO/OpenAPI et exemples (Docs/90).
- PR-9.5-B : tables catalogue prix USD, identity billing, promotions uniques, migrations et seeds, restauration versions historiques.
- PR-9.5-C : Price quote service exact au centime, capacité établissement + addons et levée du quota commercial MAX_USERS payant.
- PR-9.5-D : stabilisation E2E/nonrégression/CI, fermeture issue 9.5 et preuves, Docs/93 actualisé.

### Phase 9.6
- PR-9.6-A : tables billing invoice/payment/promotion redemption, transitions, Outbox, contract-first.
- PR-9.6-B : checkout et provider-neutral adapter + vérification et rapprochement, circuit manuel contrôlé si nécessaire.
- PR-9.6-C : renouvellements, prorata, grace/dunning, cancellation, downgrade, refunds/chargebacks, quota rights reconciliation.
- PR-9.6-D : Control Plane Billing minimal, HTTP/E2E, CI, docs de preuve et clôture issue 9.6.

## Interdictions de raccourcis
Aucune valeur d'argent côté frontend comme autorité, aucun paiement validé par retour navigateur, aucun gateway fake en prod, aucun total en float, aucun upgrade de plan sans consentement, aucune suppression des données en downgrade, aucun accès aux documents métier privés de client pour plateforme, aucun prix par utilisateur interne payant.

## Validation finale
Après clôture 9.6, reprendre **Phase 10 → 11 → 11.5 → 12** ; la Phase 11 complète le Control Plane global. Le frontend étant hors du dépôt backend, fournir son contrat OpenAPI/DTO et les exigences d'UI, pas de frontend de substitution dans le repo backend.
