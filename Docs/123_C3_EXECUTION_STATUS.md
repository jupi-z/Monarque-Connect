# C3 — Shared Catalog, Pricing, Measures & FX — statut

**Issue de suivi :** [#171](https://github.com/jupi-z/Monarque-Connect/issues/171)  
**Baseline après C3.1 :** `main@e19bd1fba2bb3757bb13ea8466383bd34fbb7846`

**CI post-fusion C3.1 :** PR #172, run [40639567210](https://github.com/jupi-z/Monarque-Connect/actions/runs/40639567210), success sur le SHA exact.

## État réel

| Lot | Statut | Migration/code | Preuve |
|---|---|---|---|
| C0 | DONE | Audit et arbitrages | Docs/115; issue #153 close |
| C1 | DONE | Registre de produits et entitlements scoped | Docs/116, Docs/118; PR #158–#162 |
| C2 | DONE | Identités externes et principaux tenant | Docs/119–121; PR #164–#169; preuve de clôture CI #561, puis `main@2dff07e` CI post-fusion #170 run 40635438412 |
| C3.1 | DONE | Audit, contrat normatif et OpenAPI proposé; aucune migration ni route runtime | PR [#172](https://github.com/jupi-z/Monarque-Connect/pull/172), fusionnée au commit `e19bd1f`; CI PR #569 et post-fusion #40639567210 vertes |
| C3.2 | NOT STARTED | Catalogue, mesures, variantes et offres | Aucun schéma ni DDL C3 livré |
| C3.3 | NOT STARTED | Pricing, politiques, FX et snapshots | Aucun moteur ni taux C3 livré |
| C3.4 | NOT STARTED | Durcissement, compatibilité et clôture | NOT_RUN |
| C4–C8 | NOT AUTHORIZED | Hors de cette mission | Pas commencé |

## Contrat et audit

Le contrat cible et les preuves d'inspection du code sont dans [Docs/122](122_C3_SHARED_CATALOG_PRICING_MEASURES_FX_CONTRACT.md). C3.1 a figé les propriétaires du Core, la distinction Billing SaaS/prix commerciaux, les snapshots, les politiques de précision et d'arrondi, les droits et l'OpenAPI proposé. La PR #172 est fusionnée et ses CI PR/post-fusion sont vertes. Le contrat OpenAPI reste `proposed-not-runtime`; aucun comportement C3 n'est implémenté. C3.2 reste NOT STARTED jusqu'à l'approbation et la fusion de son plan/migration dédiée.

## Gates de clôture C3

- Contrat OpenAPI figé avant migration.
- `Item` historique conservé et prix SaaS FairScale séparés des prix tenant.
- Migrations additives prouvées sur base vide et versions historiques supportées; données synthétiques, contraintes de concurrence et rollback/forward-fix documentés.
- Tests Decimal/mesures/arrondis, FX direct/réciproque, prix temporisés, tenant/produit/établissement, idempotence et immutabilité PostgreSQL.
- OpenAPI, contrats, unit, intégration PostgreSQL, E2E, sécurité et CI GitHub PR/post-merge verts pour chaque lot.
- Documentation de clôture avec SHA et exécutions observées.

Les gates externes du fournisseur FX réel, de fiscalité, PSP, production et commercialisation sont distincts et ne sont pas déclarés satisfaits par C3.
