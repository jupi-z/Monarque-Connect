# C3 — Shared Catalog, Pricing, Measures & FX — statut

**Issue de suivi :** [#171](https://github.com/jupi-z/Monarque-Connect/issues/171)
**Baseline vérifiée :** `main@ce7d9ae392db49419033dee959513f8da083208f` après fusion de PR #182; CI post-fusion [40750165326](https://github.com/jupi-z/Monarque-Connect/actions/runs/40750165326) réussie sur ce SHA.

**CI post-fusion C3.1 :** PR #172, run [40639567210](https://github.com/jupi-z/Monarque-Connect/actions/runs/40639567210), success sur le SHA exact.

## État réel

| Lot | Statut | Migration/code | Preuve |
|---|---|---|---|
| C0 | DONE | Audit et arbitrages | Docs/115; issue #153 close |
| C1 | DONE | Registre de produits et entitlements scoped | Docs/116, Docs/118; PR #158–#162 |
| C2 | DONE | Identités externes et principaux tenant | Docs/119–121; PR #164–#169; preuve de clôture CI #561, puis `main@2dff07e` CI post-fusion #170 run 40635438412 |
| C3.1 | DONE | Audit, contrat normatif et OpenAPI proposé; aucune migration ni route runtime | PR [#172](https://github.com/jupi-z/Monarque-Connect/pull/172), fusionnée au commit `e19bd1f`; CI PR #569 et post-fusion #40639567210 vertes |
| C3.2 | DONE | Catalogue, mesures, variantes et offres | PR #174 fusionnée dans `main@909764d`; CI post-fusion #583, run [40650502528](https://github.com/jupi-z/Monarque-Connect/actions/runs/40650502528), success. Détails actualisés dans [Docs/124](124_C3_2_CATALOG_MEASURES_EXECUTION_EVIDENCE.md). |
| C3.3 | IN PROGRESS | Prix, FX, policies, calcul Decimal et quotes persistées livrés; résolveurs discount/tax encore requis | PR #182 fusionnée au commit `ce7d9ae392db49419033dee959513f8da083208f`; CI PR [40745940521](https://github.com/jupi-z/Monarque-Connect/actions/runs/40745940521) et post-fusion [40750165326](https://github.com/jupi-z/Monarque-Connect/actions/runs/40750165326) réussies. Détails historiques dans Docs/125; règles normatives de résolution dans Docs/126. |
| C3.4 | IN PROGRESS | Résolveurs sûrs de contexte fiscal/remises, révocation de quote, sécurité, compatibilité et clôture | Contrat préparatoire Docs/126; code et preuves restent à livrer. |
| C4–C8 | NOT AUTHORIZED | Hors de cette mission | Pas commencé |

## Contrat et audit

Le contrat cible et les preuves sont dans Docs/122–126. PR #182 livre la quote tenant/product-scoped, son snapshot immuable, le calcul et le rejeu idempotent. La quote reste fail-closed pour toute policy avec codes de remise ou de taxe jusqu'à livraison des résolveurs décrits dans Docs/126. Aucun fournisseur FX réel ni conformité fiscale n'est déclaré.

## Gates de clôture C3

- Contrat OpenAPI figé avant migration.
- `Item` historique conservé et prix SaaS FairScale séparés des prix tenant.
- Migrations additives prouvées sur base vide et versions historiques supportées; données synthétiques, contraintes de concurrence et rollback/forward-fix documentés.
- Tests Decimal/mesures/arrondis, FX direct/réciproque, prix temporisés, tenant/produit/établissement, idempotence et immutabilité PostgreSQL.
- OpenAPI, contrats, unit, intégration PostgreSQL, E2E, sécurité et CI GitHub PR/post-merge verts pour chaque lot.
- Documentation de clôture avec SHA et exécutions observées.

Les gates externes du fournisseur FX réel, de fiscalité, PSP, production et commercialisation sont distincts et ne sont pas déclarés satisfaits par C3.
