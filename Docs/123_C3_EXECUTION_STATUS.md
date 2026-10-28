# C3 — Shared Catalog, Pricing, Measures & FX — statut

**Issue de suivi :** [#171](https://github.com/jupi-z/Monarque-Connect/issues/171)  
**Baseline C3 :** `main@2dff07eae662d8de186d6f23cf831dd72c1dfec9`  
**CI baseline :** post-fusion PR #170, run [40635438412](https://github.com/jupi-z/Monarque-Connect/actions/runs/40635438412), success.

## État réel

| Lot | Statut | Migration/code | Preuve |
|---|---|---|---|
| C0 | DONE | Audit et arbitrages | Docs/115; issue #153 close |
| C1 | DONE | Registre de produits et entitlements scoped | Docs/116, Docs/118; PR #158–#162 |
| C2 | DONE | Identités externes et principaux tenant | Docs/119–121; PR #164–#169; preuve de clôture CI #561, puis `main@2dff07e` CI post-fusion #170 run 40635438412 |
| C3.1 | IN PROGRESS | Audit, contrat normatif et OpenAPI proposé; aucune migration | PR [#172](https://github.com/jupi-z/Monarque-Connect/pull/172), head initial `753facaf85b98826fa45425b6043a3a45fa49b23`; CI PR avant toute implémentation |
| C3.2 | NOT STARTED | Catalogue, mesures, variantes et offres | Aucun schéma ni DDL C3 livré |
| C3.3 | NOT STARTED | Pricing, politiques, FX et snapshots | Aucun moteur ni taux C3 livré |
| C3.4 | NOT STARTED | Durcissement, compatibilité et clôture | NOT_RUN |
| C4–C8 | NOT AUTHORIZED | Hors de cette mission | Pas commencé |

## Contrat et audit

Le contrat cible et les preuves d'inspection du code sont dans [Docs/122](122_C3_SHARED_CATALOG_PRICING_MEASURES_FX_CONTRACT.md). C3.1 couvre les propriétaires du Core, la distinction Billing SaaS/prix commerciaux, les snapshots, les politiques de précision et d'arrondi, l'OpenAPI proposé, les droits et les tests contractuels. Le contrat est en revue dans C3.1; il ne prouve pas que ces fonctionnalités existent. C3.2 ne peut démarrer qu'après fusion et CI verte de C3.1.

## Gates de clôture C3

- Contrat OpenAPI figé avant migration.
- `Item` historique conservé et prix SaaS FairScale séparés des prix tenant.
- Migrations additives prouvées sur base vide et versions historiques supportées; données synthétiques, contraintes de concurrence et rollback/forward-fix documentés.
- Tests Decimal/mesures/arrondis, FX direct/réciproque, prix temporisés, tenant/produit/établissement, idempotence et immutabilité PostgreSQL.
- OpenAPI, contrats, unit, intégration PostgreSQL, E2E, sécurité et CI GitHub PR/post-merge verts pour chaque lot.
- Documentation de clôture avec SHA et exécutions observées.

Les gates externes du fournisseur FX réel, de fiscalité, PSP, production et commercialisation sont distincts et ne sont pas déclarés satisfaits par C3.
