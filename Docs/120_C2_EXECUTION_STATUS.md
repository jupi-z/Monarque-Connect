# C2 — Identity, Tenancy & Tenant Principals — statut

**C0 :** clôturé et suivi dans l'issue #153.
**C1 :** clôturé; les PR #158–#162 et la CI post-fusion #540 sont vérifiées.
**C2 : IN_PROGRESS — C2.1 accepté; contrat C2.2 fusionné; persistance et migration C2.2 en développement, non encore vérifiées par CI.** Issue de suivi : [#163](https://github.com/jupi-z/Monarque-Connect/issues/163).
**Dernière baseline validée :** `main@e52c57658af66a1b2f905dd84ebe81b08d4a7822`; CI post-fusion du contrat C2.2 [#546](https://github.com/jupi-z/Monarque-Connect/actions/runs/40598479776) réussie sur ce SHA.

| Lot | État | Gate |
|---|---|---|
| C2.1 — Contrats d'identité, acteurs et provenance | DONE | PR [#164](https://github.com/jupi-z/Monarque-Connect/pull/164), head `8100c2429468a623708f1e9b08cc2c9147ed5e6f`, merge `cf80f6d251d094b02587d64a842fbf4af8c8c7ef`, CI PR [#541](https://github.com/jupi-z/Monarque-Connect/actions/runs/40594994400) et post-fusion #542 |
| C2.2 — Contrat exact du registre et des challenges | DONE | PR [#165](https://github.com/jupi-z/Monarque-Connect/pull/165), merge `e52c57658af66a1b2f905dd84ebe81b08d4a7822`, CI PR [#545](https://github.com/jupi-z/Monarque-Connect/actions/runs/40597595319) et post-fusion #546 |
| C2.2 — Registre ExternalIdentity et migration additive | IN_PROGRESS | Migrations et service sur PR dédiée; CI, PostgreSQL, idempotence, concurrence et audit/Outbox requis avant fusion |
| C2.3 — Contexte principal et port d'identité fédérée | PLANNED | Compatibilité legacy, tenants, produit, scopes, refus BUYER/AGENT non configurés |
| C2.4 — Durcissement et preuves | PLANNED | E2E/sécurité, CI post-fusion, preuve et issue #163 |

## État réel à la baseline

- Auth legacy : `AuthPrincipal` contient `userId` et `sessionId`; le JWT garde `sub`/`sid`; `AuthGuard` vérifie une refresh session active et un utilisateur actif.
- STAFF : `AuthorizationService` résout le membership et le scope depuis PostgreSQL. Les permissions et entitlements sont vérifiés côté serveur; C1 conserve les resolvers legacy Connect et les variantes explicitement scoped par produit.
- PLATFORM : accès existant via `PlatformAuthorizationService`; C2 ne lui accorde pas de bypass de tenant.
- Aucun modèle `issuer + subject`, challenge de liaison, port OIDC, principal BUYER, authenticator AGENT ni flux de fédération runtime n'existe à cette baseline.
- La table `User` exige actuellement un `passwordHash`; C2 ne modifie pas le modèle ni le login legacy et n'ajoute aucun utilisateur fédéré autonome.
- À la baseline contractuelle, la migration courante est `20261027170000_c1_product_module_scope`. C2 ne réécrit aucune migration fusionnée; ses migrations additives de travail ne sont pas encore prouvées ni fusionnées.

## Preuve C2.1

La PR documentaire [#164](https://github.com/jupi-z/Monarque-Connect/pull/164) a été fusionnée au commit `cf80f6d251d094b02587d64a842fbf4af8c8c7ef`. La CI PR [#541](https://github.com/jupi-z/Monarque-Connect/actions/runs/40594994400) et la CI post-fusion [#542](https://github.com/jupi-z/Monarque-Connect/actions/runs/40596032467) sont réussies. Aucun schéma, migration ni comportement runtime n'a été modifié par C2.1.

## Limites déclarées

Monarque Auth/Keycloak n'est pas déployé ni connecté par C2. Jusqu'à livraison d'un validateur OIDC complet, `OIDC_RUNTIME=NOT_CONFIGURED` et tout flux fédéré réel est `NOT_RUN`. BUYER complet, AGENT runtime, POS, C3–C8 et l'application ZAMUREK restent hors livraison C2.
