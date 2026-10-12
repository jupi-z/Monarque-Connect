# 59 — Phase 2 Product Entitlements — Closure Evidence

## Décision

La Phase 2 — Product Entitlements est **clôturée à 100 %** après intégration des tranches catalogue/plans, abonnements, entitlements effectifs, activations et quotas, puis vérification de tous les gates de `57_PHASE2_PRODUCT_ENTITLEMENTS_EXECUTION_SPEC.md`.

La clôture porte sur le périmètre normatif de Phase 2. Elle ne clôt pas le MVP global et n'implémente pas la facturation réelle, les paiements, les taxes, les coupons ni les domaines métier des phases suivantes.

## Périmètre livré

- catalogue canonique de modules versionné et seed de référence idempotent ;
- plans et versions de plans immuables avec modules inclus et limites ;
- abonnements d'organisation, fenêtre d'effet UTC, transitions et expiration ;
- résolution déterministe des entitlements effectifs et projection `capabilities` versionnée ;
- overrides d'organisation `ALLOW`, `DENY` et `LIMIT_OVERRIDE`, avec validité, justification, auteur plateforme, audit et Outbox ;
- presets métier persistés et exposés comme recommandations d'onboarding ;
- activations organisationnelles explicites, idempotentes et auditées ;
- quotas par période canonique serveur, réservations/consommations atomiques, commit/libération idempotents et ledger ;
- provisionnement du plan initial et enforcement des quotas sur organisations, établissements et memberships ;
- contrainte PostgreSQL d'exclusion des périodes d'abonnement concurrentes ;
- audit et Domain Events Outbox transactionnels pour chaque mutation du Control Plane ;
- routes HTTP protégées : capabilities, modules, activation et quotas ;
- contrats OpenAPI détaillés pour les réponses consommées par les clients.

## Gates vérifiés

- [x] migration complète depuis une base PostgreSQL vide ;
- [x] upgrade explicite depuis la baseline complète de Phase 1 vers les quatre migrations Phase 2 ;
- [x] seed idempotent, y compris sous invocations concurrentes ;
- [x] transitions d'abonnement, répétitions idempotentes et expiration aux bornes UTC ;
- [x] concurrence des réservations de quotas avec limite atomique `used + reserved` ;
- [x] consommation atomique des quotas lors de la création des ressources et refus sous concurrence ;
- [x] période calculée côté serveur et `LIMIT_OVERRIDE` appliqué à la capacité effective ;
- [x] commit/libération de réservation idempotents avec invariants et ledger ;
- [x] isolation tenant/établissement réutilisant les contrôles Identity/Tenancy ;
- [x] audit et Outbox atomiques pour abonnements, activations et quotas ;
- [x] E2E HTTP du parcours identité/tenant/capabilities/modules/activation/quotas ;
- [x] aucun endpoint ne traite `modules: []` comme une autorisation implicite ;
- [x] `defaultEnabled` ne détermine plus l'inclusion au plan ;
- [x] tests `ALLOW`, `DENY`, `LIMIT_OVERRIDE`, presets métier, règle Intelligence et chevauchement concurrent ;
- [x] OpenAPI, contrats machine-readable, lint, typecheck, build et suite PostgreSQL verts ;
- [x] PR obligatoires, revue, CI GitHub verte, squash merge et suppression de la branche de travail ;
- [x] workflow de protection suivi ; la ruleset technique de `main` reste un prérequis externe non disponible sur le plan GitHub courant, documenté dans l'issue de gouvernance.

## Preuves reproductibles

Depuis une copie propre du dépôt avec PostgreSQL disponible :

```bash
npm ci
npm run prisma:generate
npm run prisma:phase2:migration-proof
npm run prisma:deploy
npm run openapi:validate
npm run contracts:validate
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

`prisma:phase2:migration-proof` crée deux bases temporaires dédiées, applique les migrations depuis zéro, applique ensuite la baseline Phase 1 puis toutes les migrations Phase 2, vérifie `_prisma_migrations` et supprime les bases temporaires.

## Tracé Git

Les tranches ont été livrées par PR courtes et squash-mergées sur `main` : #28, #30, #32, #33, #34, #35, puis la PR de hardening #37. La CI Backend #142 (`38240149219`) est verte et le merge squash a produit `63284e3960efa5648a00b9e7eeb82c407fe9fdb7`.

Après merge, `main` doit être le seul checkout et la branche de clôture doit être supprimée localement et sur `origin`.

## Suite

La prochaine phase est la Phase 3 — Référentiels : business parties, catalogue métier et warehouses. Les clients peuvent désormais construire leur navigation dynamique depuis `GET /organizations/{organizationId}/capabilities`, sans recopier la logique d'entitlement.
