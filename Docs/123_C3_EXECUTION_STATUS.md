# C3 — Shared Catalog, Pricing, Measures & FX — statut

**Issue de suivi :** [#171](https://github.com/jupi-z/Monarque-Connect/issues/171)
**État final vérifié :** C3 techniquement clôturé sur `main@46b8b61b1ed670cd0b6e7c433db1986da61d468d` après PR #187. CI PR [40850299703](https://github.com/jupi-z/Monarque-Connect/actions/runs/40850299703) réussie sur le head `a9ebb59f75a145dc79a1a93cb18308495c513651`; CI post-fusion [40851397121](https://github.com/jupi-z/Monarque-Connect/actions/runs/40851397121) réussie sur le merge SHA `46b8b61b1ed670cd0b6e7c433db1986da61d468d`.

**CI post-fusion C3.1 :** PR #172, run [40639567210](https://github.com/jupi-z/Monarque-Connect/actions/runs/40639567210), success sur le SHA exact.

## État réel

| Lot | Statut | Migration/code | Preuve |
|---|---|---|---|
| C0 | DONE | Audit et arbitrages | Docs/115; issue #153 close |
| C1 | DONE | Registre de produits et entitlements scoped | Docs/116, Docs/118; PR #158–#162 |
| C2 | DONE | Identités externes et principaux tenant | Docs/119–121; PR #164–#169; preuve de clôture CI #561, puis `main@2dff07e` CI post-fusion #170 run 40635438412 |
| C3.1 | DONE | Audit, contrat normatif et OpenAPI proposé; aucune migration ni route runtime | PR [#172](https://github.com/jupi-z/Monarque-Connect/pull/172), fusionnée au commit `e19bd1f`; CI PR #569 et post-fusion #40639567210 vertes |
| C3.2 | DONE | Catalogue, mesures, variantes et offres | PR #174 fusionnée dans `main@909764d`; CI post-fusion #583, run [40650502528](https://github.com/jupi-z/Monarque-Connect/actions/runs/40650502528), success. Détails actualisés dans [Docs/124](124_C3_2_CATALOG_MEASURES_EXECUTION_EVIDENCE.md). |
| C3.3 | DONE | Prix commerciaux versionnés, FX, policies, calcul Decimal et quotes persistées; résolution de taxes et remises livrée | PR #182–#186 fusionnées; références historiques dans Docs/125–126. CI post-fusion PR #186 [40846748088](https://github.com/jupi-z/Monarque-Connect/actions/runs/40846748088) verte sur `main@45b5558fe08a78e82338dc4e6e3a9bed99549d48`. |
| C3.4 | DONE | Révocation append-only des quotes; contrôles Owner/Admin, tenant/produit/établissement, idempotence, audit/Outbox atomiques et snapshot inchangé | PR [#187](https://github.com/jupi-z/Monarque-Connect/pull/187) fusionnée; CI PR [40850299703](https://github.com/jupi-z/Monarque-Connect/actions/runs/40850299703), post-fusion [40851397121](https://github.com/jupi-z/Monarque-Connect/actions/runs/40851397121). Preuve de clôture: [Docs/127](127_C3_CLOSURE_EVIDENCE.md). |
| C4–C8 | NOT AUTHORIZED | Hors de cette mission | Pas commencé; C3 ne livre ni POS, ni fiscalisation officielle, ni interface client. |

## Contrat et audit

Le contrat cible et les preuves sont dans Docs/122–127. Les routes, règles, mesures, prix/FX et snapshots C3 ont été validés par les contrôles CI PR et post-fusion référencés. Aucun fournisseur FX réel ni conformité fiscale n'est déclaré.

## Gates de clôture C3

- Contrat OpenAPI figé avant migration.
- `Item` historique conservé et prix SaaS FairScale séparés des prix tenant.
- Migrations additives prouvées sur base vide et versions historiques supportées; données synthétiques, contraintes de concurrence et rollback/forward-fix documentés.
- Tests Decimal/mesures/arrondis, FX direct/réciproque, prix temporisés, tenant/produit/établissement, idempotence et immutabilité PostgreSQL.
- OpenAPI, contrats, unit, intégration PostgreSQL, E2E, sécurité et CI GitHub PR/post-merge verts pour chaque lot.
- Documentation de clôture avec SHA et exécutions observées.

Les gates externes du fournisseur FX réel, de fiscalité, PSP, production et commercialisation sont distincts et ne sont pas déclarés satisfaits par C3.
