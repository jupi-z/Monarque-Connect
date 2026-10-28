# C3 — Shared Catalog, Pricing, Measures & FX — statut

**Issue de suivi :** [#171](https://github.com/jupi-z/Monarque-Connect/issues/171)  
**Baseline actuelle après C3.3.4 :** `main@173d68ff9bc8bb0beab16e4e0e72d788b91435b8` (PR #180 fusionnée); CI post-fusion [40705791462](https://github.com/jupi-z/Monarque-Connect/actions/runs/40705791462) réussie.

**CI post-fusion C3.1 :** PR #172, run [40639567210](https://github.com/jupi-z/Monarque-Connect/actions/runs/40639567210), success sur le SHA exact.

## État réel

| Lot | Statut | Migration/code | Preuve |
|---|---|---|---|
| C0 | DONE | Audit et arbitrages | Docs/115; issue #153 close |
| C1 | DONE | Registre de produits et entitlements scoped | Docs/116, Docs/118; PR #158–#162 |
| C2 | DONE | Identités externes et principaux tenant | Docs/119–121; PR #164–#169; preuve de clôture CI #561, puis `main@2dff07e` CI post-fusion #170 run 40635438412 |
| C3.1 | DONE | Audit, contrat normatif et OpenAPI proposé; aucune migration ni route runtime | PR [#172](https://github.com/jupi-z/Monarque-Connect/pull/172), fusionnée au commit `e19bd1f`; CI PR #569 et post-fusion #40639567210 vertes |
| C3.2 | DONE | Catalogue, mesures, variantes et offres | PR #174 fusionnée dans `main@909764d`; CI post-fusion #583, run [40650502528](https://github.com/jupi-z/Monarque-Connect/actions/runs/40650502528), success. Détails actualisés dans [Docs/124](124_C3_2_CATALOG_MEASURES_EXECUTION_EVIDENCE.md). |
| C3.3 | IN PROGRESS | Prix, FX et policies livrés; noyau de calcul de ligne livré; devis persistés/snapshots encore ouverts | C3.3.1–C3.3.3 sont documentés dans Docs/125. C3.3.4 (PR [#180](https://github.com/jupi-z/Monarque-Connect/pull/180)) a livré le noyau Decimal pur, fusionné dans `main@173d68ff9bc8bb0beab16e4e0e72d788b91435b8`; CI PR [40704490523](https://github.com/jupi-z/Monarque-Connect/actions/runs/40704490523) et post-fusion [40705791462](https://github.com/jupi-z/Monarque-Connect/actions/runs/40705791462) réussies. Les quotes, lignes persistées, snapshots immuables et intégration du résolveur restent à livrer; C3.4 demeure ouvert. |
| C3.4 | NOT STARTED | Durcissement, compatibilité et clôture | NOT_RUN |
| C4–C8 | NOT AUTHORIZED | Hors de cette mission | Pas commencé |

## Contrat et audit

Le contrat cible et les preuves d'inspection du code sont dans [Docs/122](122_C3_SHARED_CATALOG_PRICING_MEASURES_FX_CONTRACT.md). C3.1 a figé les propriétaires du Core, la distinction Billing SaaS/prix commerciaux, les snapshots, les politiques de précision et d'arrondi, les droits et les contrats OpenAPI proposés. C3.2 est fusionné et validé par CI post-fusion #583. C3.3.1–C3.3.3 (prix versionnés, FX, policies de prix et configurations fiscales explicites) sont livrés. C3.3.4 (PR #180) a ajouté un calcul pur de ligne Decimal avec mesures exactes, remises et taxes résolues, bases taxables et totaux source/cible; il n'ajoute ni résolution de policies, ni API, ni devis/snapshot persistant. Le service de cotation persistant et le durcissement C3.4 restent ouverts. Aucun fournisseur FX réel ni conformité fiscale n'est déclaré.

## Gates de clôture C3

- Contrat OpenAPI figé avant migration.
- `Item` historique conservé et prix SaaS FairScale séparés des prix tenant.
- Migrations additives prouvées sur base vide et versions historiques supportées; données synthétiques, contraintes de concurrence et rollback/forward-fix documentés.
- Tests Decimal/mesures/arrondis, FX direct/réciproque, prix temporisés, tenant/produit/établissement, idempotence et immutabilité PostgreSQL.
- OpenAPI, contrats, unit, intégration PostgreSQL, E2E, sécurité et CI GitHub PR/post-merge verts pour chaque lot.
- Documentation de clôture avec SHA et exécutions observées.

Les gates externes du fournisseur FX réel, de fiscalité, PSP, production et commercialisation sont distincts et ne sont pas déclarés satisfaits par C3.
