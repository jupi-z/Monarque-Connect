# 22 — Répartition des workstreams

## Backend/API
**Owner : `@jupi-z`**

Périmètre : architecture backend, DB, migrations, auth, sécurité, API, OpenAPI final, tests backend, observabilité, déploiement backend.

Ce workstream n'est pas à choisir par un autre contributeur sauf accord explicite.

## Workstreams ouverts à `@Gabby344`

### A — Business Web Client — priorité recommandée
Application principale pour les entreprises.  
Dépôt séparé. Consomme exclusivement OpenAPI.

### B — Platform Admin Client
Console interne Monarque Group : tenants, users, santé opérationnelle, support.

### C — Design System / UX implementation
Design tokens, composants et UX commune aux clients.

### D — QA / Contract Testing
Tests consommateurs OpenAPI, scénarios E2E clients, régression UI.

### E — Developer Experience / Documentation
SDK généré, exemples d'intégration, documentation client.

## Procédure
`@Gabby344` ouvre l'issue **Workstream declaration** et choisit :
- 1 workstream principal ;
- un périmètre précis ;
- un premier jalon.

Le choix d'un frontend entraînera la création d'un dépôt client distinct.
