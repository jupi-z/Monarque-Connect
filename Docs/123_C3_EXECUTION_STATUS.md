# C3 — Shared Catalog, Pricing, Measures & FX — statut

**Issue de suivi :** [#171](https://github.com/jupi-z/Monarque-Connect/issues/171)  
**Baseline d’exécution C3.3.2 :** `main@ab3d99a3507d3d24c089b071f01e9d7094996305` (après fusion PR #176)

**CI post-fusion C3.1 :** PR #172, run [40639567210](https://github.com/jupi-z/Monarque-Connect/actions/runs/40639567210), success sur le SHA exact.

## État réel

| Lot | Statut | Migration/code | Preuve |
|---|---|---|---|
| C0 | DONE | Audit et arbitrages | Docs/115; issue #153 close |
| C1 | DONE | Registre de produits et entitlements scoped | Docs/116, Docs/118; PR #158–#162 |
| C2 | DONE | Identités externes et principaux tenant | Docs/119–121; PR #164–#169; preuve de clôture CI #561, puis `main@2dff07e` CI post-fusion #170 run 40635438412 |
| C3.1 | DONE | Audit, contrat normatif et OpenAPI proposé; aucune migration ni route runtime | PR [#172](https://github.com/jupi-z/Monarque-Connect/pull/172), fusionnée au commit `e19bd1f`; CI PR #569 et post-fusion #40639567210 vertes |
| C3.2 | DONE | Catalogue, mesures, variantes et offres | PR #174 fusionnée dans `main@909764d`; CI post-fusion #583, run [40650502528](https://github.com/jupi-z/Monarque-Connect/actions/runs/40650502528), success. Détails actualisés dans [Docs/124](124_C3_2_CATALOG_MEASURES_EXECUTION_EVIDENCE.md). |
| C3.3 | IN PROGRESS | Prix versionnés, calcul déterministe, policies, FX et cotations snapshotées | C3.3.1 fusionné par PR #175 au SHA `1a19705`; CI PR #175 run [40657030191](https://github.com/jupi-z/Monarque-Connect/actions/runs/40657030191) et post-fusion [40657980533](https://github.com/jupi-z/Monarque-Connect/actions/runs/40657980533) réussies. C3.3.2, registre FX persistant, est fusionné par PR [#176](https://github.com/jupi-z/Monarque-Connect/pull/176) au SHA `ab3d99a`; CI PR [40664290224](https://github.com/jupi-z/Monarque-Connect/actions/runs/40664290224) et CI post-fusion [40665166818](https://github.com/jupi-z/Monarque-Connect/actions/runs/40665166818) réussies. Voir [Docs/125](125_C3_3_PRICE_VERSION_EXECUTION_STATUS.md). |
| C3.4 | NOT STARTED | Durcissement, compatibilité et clôture | NOT_RUN |
| C4–C8 | NOT AUTHORIZED | Hors de cette mission | Pas commencé |

## Contrat et audit

Le contrat cible et les preuves d'inspection du code sont dans [Docs/122](122_C3_SHARED_CATALOG_PRICING_MEASURES_FX_CONTRACT.md). C3.1 a figé les propriétaires du Core, la distinction Billing SaaS/prix commerciaux, les snapshots, les politiques de précision et d'arrondi, les droits et les contrats OpenAPI proposés. C3.2 est fusionné et validé par CI post-fusion #583. C3.3.1 (prix commerciaux versionnés et primitive Decimal) est fusionné et validé; C3.3.2 (registre FX persistant plateforme) est fusionné par PR #176 au SHA `ab3d99a`, avec CI PR #40664290224 et post-fusion #40665166818 réussies. Les policies de pricing/fiscalité, les snapshots de cotation et le durcissement restent ouverts. C3.4 n'a pas commencé.

## Gates de clôture C3

- Contrat OpenAPI figé avant migration.
- `Item` historique conservé et prix SaaS FairScale séparés des prix tenant.
- Migrations additives prouvées sur base vide et versions historiques supportées; données synthétiques, contraintes de concurrence et rollback/forward-fix documentés.
- Tests Decimal/mesures/arrondis, FX direct/réciproque, prix temporisés, tenant/produit/établissement, idempotence et immutabilité PostgreSQL.
- OpenAPI, contrats, unit, intégration PostgreSQL, E2E, sécurité et CI GitHub PR/post-merge verts pour chaque lot.
- Documentation de clôture avec SHA et exécutions observées.

Les gates externes du fournisseur FX réel, de fiscalité, PSP, production et commercialisation sont distincts et ne sont pas déclarés satisfaits par C3.
