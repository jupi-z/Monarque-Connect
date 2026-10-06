# 22 — Répartition des workstreams

## Backend/API

**Owner : `@jupi-z`**

Périmètre : architecture backend, DB, migrations, auth, tenancy, establishments, entitlements, sécurité, domaines métier, OpenAPI final, tests backend, intelligence backend, control plane backend, observabilité et déploiement.

Ce workstream n'est pas à choisir par un autre contributeur sauf accord explicite.

## Workstreams ouverts à `@Gabby344`

### A — Business Web Client — priorité recommandée
Application principale pour les entreprises. Dépôt séparé. Consomme exclusivement OpenAPI et construit sa navigation depuis `capabilities`.

Attendus initiaux :
- auth/session ;
- organization switcher ;
- establishment switcher ;
- navigation dynamique par module ;
- composants de permissions sans en faire une autorité sécurité ;
- premiers écrans alignés sur les contrats de Phase 1/2.

### B — Platform Admin Client
Console interne Monarque Group pour tenants, plans, entitlements, quotas, support et santé opérationnelle. Dépôt séparé.

### C — Design System / UX implementation
Design tokens, composants et UX commune aux clients.

### D — QA / Contract Testing
Tests consommateurs OpenAPI, scénarios E2E clients, régression UI, matrices capabilities/plans.

### E — Developer Experience / Documentation
SDK généré, mocks OpenAPI, exemples d'intégration, documentation client.

## Procédure

`@Gabby344` choisit :
- 1 workstream principal ;
- un périmètre précis ;
- un premier jalon ;
- ses dépendances sur le contrat API.

Aucun frontend ne doit commencer par recopier en dur les plans ou le catalogue de modules.
