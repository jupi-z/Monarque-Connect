# C1 — Product Catalog & Product-Scoped Entitlements — suivi

**Phase 10A.5 C0 :** acceptée et clôturée après fusion de la PR #152 (`78b91675e26a83e15be1539f7b3cc4f2a058a0b6`) et CI post-fusion verte ([run #40530366585](https://github.com/jupi-z/Monarque-Connect/actions/runs/40530366585)).

**C1 : IN PROGRESS.** Référence de contrat : [Docs/116](116_C1_PRODUCT_CATALOG_AND_ENTITLEMENTS_CONTRACT.md). Ce suivi ne certifie aucun lot comme livré avant CI PR et post-fusion.

| Lot | État | Limite et preuve de sortie |
|---|---|---|
| C1.1 — Contrats produit et compatibilité legacy | DONE | PR #158 fusionnée au commit `a9d3c45e23f97aec896da6a1613f3ca95c6f2bce`; CI PR #40532056291 et post-fusion #40533031232 vertes. Codes contrôlés et compatibilité golden du resolver legacy. |
| C1.2 — Catalogue et migration additive | DONE | PR #159 fusionnée dans `cd5eb2fb0272bbe08abde60809ece945699c9bae`. CI PR #526 verte ([run](https://github.com/jupi-z/Monarque-Connect/actions/runs/40547700525)); CI post-fusion #527 verte sur le merge SHA ([run](https://github.com/jupi-z/Monarque-Connect/actions/runs/40549013044)). Preuves: 55 migrations base vide, 53+2 Phase 9.6, 54+1 C1.1, 175 unitaires, 189 intégration, 28 E2E, répétitions CRM/Phase 1, smoke/build/cleanup. |
| C1.3 — Resolver et services produit | IN PROGRESS | Branche `monarque/c1-3-product-entitlements`; registre serveur `ProductModule`, contraintes composées, resolver produit, souscriptions, overrides, activations et quotas isolés. Pas d'offre ZAMUREK activée. CI GitHub-hosted et preuve post-fusion requises. |
| C1.4 — Compatibilité et durcissement | NOT STARTED | Après C1.3; suite de régression inter-domaines et E2E, CI PR et post-fusion verte. |

**Périmètre arrêté :** aucun C2–C8, 10B–12, runtime Monarque Auth, application ZAMUREK, prix ou offre ZAMUREK activés. La PR ZAMUREK #2 reste en brouillon.

**Exécution locale :** aucun test lourd, conteneur, build ou migration n'est lancé sur le poste. Les validations correspondantes sont confiées aux runners GitHub-hosted.
