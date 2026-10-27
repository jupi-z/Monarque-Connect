# C1 — Product Catalog & Product-Scoped Entitlements — suivi

**Phase 10A.5 C0 :** acceptée et clôturée après fusion de la PR #152 (`78b91675e26a83e15be1539f7b3cc4f2a058a0b6`) et CI post-fusion verte ([run #40530366585](https://github.com/jupi-z/Monarque-Connect/actions/runs/40530366585)).

**C1 : IN PROGRESS.** Référence de contrat : [Docs/116](116_C1_PRODUCT_CATALOG_AND_ENTITLEMENTS_CONTRACT.md). Ce suivi ne certifie aucun lot comme livré avant CI PR et post-fusion.

| Lot | État | Limite et preuve de sortie |
|---|---|---|
| C1.1 — Contrats produit et compatibilité legacy | IN PROGRESS | Codes produit serveur initiaux et tests unitaires purs; golden tests du resolver legacy; aucun changement de schéma. CI GitHub-hosted verte avant fusion. |
| C1.2 — Catalogue et migration additive | NOT STARTED | Après C1.1 fusionné et CI `main` verte; backfill vérifié, contraintes composées et preuves PostgreSQL depuis vide et états historiques. |
| C1.3 — Resolver et services produit | NOT STARTED | Après C1.2; filtres produit explicites, Connect legacy inchangé, quotas, activations, overrides et suspensions isolés. |
| C1.4 — Compatibilité et durcissement | NOT STARTED | Après C1.3; suite de régression inter-domaines et E2E, CI PR et post-fusion verte. |

**Périmètre arrêté :** aucun C2–C8, 10B–12, runtime Monarque Auth, application ZAMUREK, prix ou offre ZAMUREK activés. La PR ZAMUREK #2 reste en brouillon.

**Exécution locale :** aucun test lourd, conteneur, build ou migration n'est lancé sur le poste. Les validations correspondantes sont confiées aux runners GitHub-hosted.
