# Phase 10A.5 — C1 Product Catalog & Product-Scoped Entitlements

**Statut : C1 techniquement clôturé.** Cette preuve couvre le catalogue produit, le backfill Connect, les services d'entitlements et de quotas scoped, ainsi que la compatibilité des surfaces historiques. Elle ne clôture pas C2–C8 et n'autorise pas leur démarrage.

## 1. Livraisons et SHA

| Lot | PR / head | Commit `main` | CI PR | CI post-fusion |
|---|---|---|---|---|
| C1.1 — codes produit et compatibilité legacy | [#158](https://github.com/jupi-z/Monarque-Connect/pull/158), head `6d7271f25d26f2ba2a7b631697c9cad9ccf026b7` | `a9d3c45e23f97aec896da6a1613f3ca95c6f2bce` | [#40532056291](https://github.com/jupi-z/Monarque-Connect/actions/runs/40532056291) | [#40533031232](https://github.com/jupi-z/Monarque-Connect/actions/runs/40533031232) |
| C1.2 — catalogue et migration additive | [#159](https://github.com/jupi-z/Monarque-Connect/pull/159), head `ff87253a480abf83ce9829fa016ea8ad96b30941` | `cd5eb2fb0272bbe08abde60809ece945699c9bae` | [#40547700525](https://github.com/jupi-z/Monarque-Connect/actions/runs/40547700525) | [#40549013044](https://github.com/jupi-z/Monarque-Connect/actions/runs/40549013044) |
| C1.3 — services scoped par produit | [#160](https://github.com/jupi-z/Monarque-Connect/pull/160), head `21435150f2fb1400a5e84e42cd72f7467c1df995` | `635e2a4169ade3a0daa19edab68057d930ea6668` | [#40556171997](https://github.com/jupi-z/Monarque-Connect/actions/runs/40556171997) | [#40557775470](https://github.com/jupi-z/Monarque-Connect/actions/runs/40557775470) |
| C1.4 — compatibilité et isolation finales | [#161](https://github.com/jupi-z/Monarque-Connect/pull/161), head `748ab5c8898b9623fde31128a3e0d8400b624079` | `8546236d2afa849c16ab1c2d6a953934212d08d8` | [#40562217629](https://github.com/jupi-z/Monarque-Connect/actions/runs/40562217629) | [#40563823918](https://github.com/jupi-z/Monarque-Connect/actions/runs/40563823918) |

La branche `main` a été vérifiée sur le merge SHA C1.4 ci-dessus. Les quatre PR sont fusionnées; aucune migration historique n'a été réécrite.

## 2. Résolution du périmètre fonctionnel C1

- Le registre de produits initial contient `MONARQUE_CONNECT` et `ZAMUREK`; l'extension à d'autres produits reste contrôlée côté serveur.
- Les données historiques ont été rattachées à `MONARQUE_CONNECT` sans remplacer les identifiants historiques.
- Les abonnements, activations, overrides, quotas, opérations de réservation et références de plan sont explicitement scoped par produit. Les contraintes PostgreSQL empêchent les associations de modules hors registre et les chevauchements d'abonnement effectif du même produit.
- `SubscriptionService.resolveEffective(organizationId, ...)` et le resolver d'entitlements legacy continuent à résoudre les droits Monarque Connect. Les resolvers scoped exigent le code produit et ne font aucun fallback.
- Pour maintenir la forme de réponse historique, la projection legacy peut encore lister un code de module enregistré uniquement pour un autre produit. Ce code est explicitement refusé (`allowed: false`, `MODULE_NOT_INCLUDED`); l'activation, le plan et l'override d'un autre produit ne lui accordent pas de droit Connect.
- Une suspension de produit reste isolée; la suspension globale de l'organisation demeure prioritaire.
- Aucune offre, grille de prix ou entitlements commerciaux ZAMUREK n'est activé. L'hypothèse de 7 USD/mois reste inactive.

## 3. Diagnostic C1.4 et intégrité des tests

La CI #535 sur l'intermédiaire `37f2083909b7de01a8d01cf40c53afc5b6f740df` a échoué dans un test existant de compatibilité : le filtrage du catalogue partagé supprimait un module ZAMUREK que le resolver legacy doit retourner comme explicitement non inclus. L'implémentation a été corrigée pour conserver la projection historique; le test de régression vérifie maintenant que les droits du module restent refusés et que capacités, plan et quotas historiques restent Connect. Aucune assertion de sécurité n'a été affaiblie.

La CI finale de la PR #161 a réussi sur son head exact. Les vérifications observées comprennent :

- Prisma, lint, typecheck, audit des dépendances, validation des contrats et OpenAPI à 200 opérations.
- 56 migrations appliquées depuis une base vide et preuves d'upgrade des états historiques pris en charge.
- 175 tests unitaires, 195 tests d'intégration PostgreSQL et 28 tests HTTP E2E.
- Répétitions CRM et Phase 1 dans les deux ordres, build de production et smoke HTTP.
- Nettoyage réussi du conteneur PostgreSQL isolé.

La CI post-fusion [#40563823918](https://github.com/jupi-z/Monarque-Connect/actions/runs/40563823918) a également réussi sur `8546236d2afa849c16ab1c2d6a953934212d08d8`.

## 4. Migrations et retour arrière

C1.2 et C1.3 ont introduit les changements de schéma additifs et leur backfill Connect. Les preuves de base vide et d'upgrade figurent dans les runs CI ci-dessus. C1.4 ne modifie ni schéma ni migration; elle ajoute des assertions d'intégration de compatibilité multi-produit. Les difficultés rencontrées pendant les anciennes tentatives de CI sont décrites dans les PR concernées; seuls les runs finaux verts sont considérés comme preuve de livraison.

Les changements de catalogue et de scope produit ne doivent pas être annulés par suppression des données rétro-remplies. Un retour applicatif doit conserver les nouvelles structures et utiliser un forward-fix ou une restauration contrôlée selon Docs/116. Les exercices de restauration complets restent un gate opérationnel ultérieur.

## 5. Limites et suites

- Cette validation ne prouve ni intégration d'un PSP réel, ni conformité juridique/fiscale, ni préparation commerciale FairScale.
- Les contrats d'intégration externes ZAMUREK restent en revue : sa [PR documentaire #2](https://github.com/jupi-z/ZAMUREK/pull/2) demeure en brouillon au head `1a0e81801211d8c296f9facbbc40ab7d9ec81f59`; sa CI documentaire [#40528958779](https://github.com/jupi-z/ZAMUREK/actions/runs/40528958779) a réussi. Aucun code d'application ni aucune offre commerciale ne sont activés.
- Monarque Auth/OIDC, identité BUYER/AGENT, POS atomique, FX versionné, stockage durable, sauvegarde/restauration, charge, RPO/RTO et runtime d'agents ne sont pas livrés par C1.
- Aucun développement C2–C8, 10B–12 ni application ZAMUREK n'a commencé dans ce lot.
- Aucun test lourd, build ou migration n'a été exécuté sur le poste local; les validations sont celles des runners GitHub-hosted.

**Verdict de sortie : C1 = DONE, preuves CI PR et post-fusion vérifiées.** La readiness technique de C1 ne vaut pas autorisation de commencer C2; cette autorisation attend une décision distincte du propriétaire.
