# C1 — Product Catalog & Product-Scoped Entitlements — suivi

**Phase 10A.5 C0 :** acceptée et clôturée après fusion de la PR #152 (`78b91675e26a83e15be1539f7b3cc4f2a058a0b6`) et CI post-fusion verte ([run #40530366585](https://github.com/jupi-z/Monarque-Connect/actions/runs/40530366585)).

**C1 : DONE.** Référence normative : [Docs/116](116_C1_PRODUCT_CATALOG_AND_ENTITLEMENTS_CONTRACT.md). Les preuves des PR et CI finales sont rassemblées dans [Docs/118](118_C1_CLOSURE_EVIDENCE.md).

| Lot | État | Limite et preuve de sortie |
|---|---|---|
| C1.1 — Contrats produit et compatibilité legacy | DONE | PR #158 fusionnée au commit `a9d3c45e23f97aec896da6a1613f3ca95c6f2bce`; CI PR #40532056291 et post-fusion #40533031232 vertes. Codes contrôlés et compatibilité golden du resolver legacy. |
| C1.2 — Catalogue et migration additive | DONE | PR #159 fusionnée dans `cd5eb2fb0272bbe08abde60809ece945699c9bae`. CI PR #526 verte ([run](https://github.com/jupi-z/Monarque-Connect/actions/runs/40547700525)); CI post-fusion #527 verte sur le merge SHA ([run](https://github.com/jupi-z/Monarque-Connect/actions/runs/40549013044)). Preuves: 55 migrations base vide, 53+2 Phase 9.6, 54+1 C1.1, 175 unitaires, 189 intégration, 28 E2E, répétitions CRM/Phase 1, smoke/build/cleanup. |
| C1.3 — Resolver et services produit | DONE | PR [#160](https://github.com/jupi-z/Monarque-Connect/pull/160), head `21435150f2fb1400a5e84e42cd72f7467c1df995`, merge `635e2a4169ade3a0daa19edab68057d930ea6668`; CI PR [#40556171997](https://github.com/jupi-z/Monarque-Connect/actions/runs/40556171997) et post-fusion [#40557775470](https://github.com/jupi-z/Monarque-Connect/actions/runs/40557775470) réussies. Produit, subscriptions, overrides, activations et quotas isolés; aucune offre commerciale ZAMUREK active. |
| C1.4 — Compatibilité et durcissement | DONE | PR [#161](https://github.com/jupi-z/Monarque-Connect/pull/161), head `748ab5c8898b9623fde31128a3e0d8400b624079`, merge `8546236d2afa849c16ab1c2d6a953934212d08d8`; CI PR #536 et post-fusion #537. Test PostgreSQL vérifiant qu'une souscription, activation et entitlement ZAMUREK ne donnent aucun droit dans les surfaces legacy Connect, tout en conservant leur projection historique. Détails et compteurs : Docs/118. |

**Périmètre arrêté :** aucun C2–C8, 10B–12, runtime Monarque Auth, application ZAMUREK, prix ou offre ZAMUREK activés. La PR ZAMUREK #2 reste en brouillon.

**Exécution locale :** aucun test lourd, conteneur, build ou migration n'est lancé sur le poste. Les validations correspondantes sont confiées aux runners GitHub-hosted.

**État de référence C1 clôturé :** merge C1.4 `main@8546236d2afa849c16ab1c2d6a953934212d08d8`; CI post-fusion #537 verte. Les détails d'exécution et les limites sont consignés dans [Docs/118](118_C1_CLOSURE_EVIDENCE.md).
