# C2 — Identity, Tenancy & Tenant Principals — statut

**C0 :** clôturé et suivi dans l'issue #153.
**C1 :** clôturé; les PR #158–#162 et la CI post-fusion #540 sont vérifiées.
**C2 : IN_PROGRESS — C2.1 accepté; C2.2 fusionné; C2.3 en implémentation sur branche dédiée; C2.4 reste à faire.** Issue de suivi : [#163](https://github.com/jupi-z/Monarque-Connect/issues/163).
**Dernière baseline validée :** `main@e57e5b4f36660f28234044f14d55ede9df59654f`; CI post-fusion #552 [réussie](https://github.com/jupi-z/Monarque-Connect/actions/runs/40603636573) sur le commit de fusion.

| Lot | État | Gate |
|---|---|---|
| C2.1 — Contrats d'identité, acteurs et provenance | DONE | PR [#164](https://github.com/jupi-z/Monarque-Connect/pull/164), head `8100c2429468a623708f1e9b08cc2c9147ed5e6f`, merge `cf80f6d251d094b02587d64a842fbf4af8c8c7ef`, CI PR [#541](https://github.com/jupi-z/Monarque-Connect/actions/runs/40594994400) et post-fusion #542 |
| C2.2 — Contrat exact du registre et des challenges | DONE | PR [#165](https://github.com/jupi-z/Monarque-Connect/pull/165), merge `e52c57658af66a1b2f905dd84ebe81b08d4a7822`, CI PR [#545](https://github.com/jupi-z/Monarque-Connect/actions/runs/40597595319) et post-fusion #546 |
| C2.2 — Registre ExternalIdentity et migration additive | DONE | PR [#166](https://github.com/jupi-z/Monarque-Connect/pull/166), head `99b27a135486edf492bb640066acda88cd9352a2`, merge `e57e5b4f36660f28234044f14d55ede9df59654f`; CI PR [#551](https://github.com/jupi-z/Monarque-Connect/actions/runs/40602789649), post-fusion #552 verte; 58 migrations depuis base vide et upgrades historiques, 13 tests PostgreSQL C2, concurrence et audit/Outbox validés |
| C2.3 — Contexte principal et autorisation produit | IN_REVIEW | Principal STAFF dérivé côté serveur, port OIDC non configuré, résolveurs legacy/scopés explicitement; PR et CI de la branche courante à enregistrer après publication |
| C2.4 — Durcissement et preuves | PLANNED | E2E/sécurité, CI post-fusion, preuve et issue #163 |

## État réel à la baseline

- Auth legacy : `AuthPrincipal` contient `userId` et `sessionId`; le JWT garde `sub`/`sid`; `AuthGuard` vérifie une refresh session active et un utilisateur actif.
- STAFF : `AuthorizationService` résout le membership et le scope depuis PostgreSQL. Les permissions et entitlements sont vérifiés côté serveur; C1 conserve les resolvers legacy Connect et les variantes explicitement scoped par produit.
- PLATFORM : accès existant via `PlatformAuthorizationService`; C2 ne lui accorde pas de bypass de tenant.
- C2.2 livre le modèle `issuer + subject`, challenges et service interne de liaison. C2.3 ajoute le port OIDC sans implémentation/provider runtime; BUYER et AGENT n'ont toujours pas d'authenticator et restent indisponibles.
- La table `User` exige actuellement un `passwordHash`; C2 ne modifie pas le modèle ni le login legacy et n'ajoute aucun utilisateur fédéré autonome.
- Les migrations C2 additives `20261028090000_c2_external_identity_audit_actions` et `20261028090100_c2_external_identity_tables` sont vérifiées par les CI #551 et #552 depuis base vide et upgrades Phase 9.6/C1; aucune migration fusionnée n'a été réécrite.

## Preuve C2.1

La PR documentaire [#164](https://github.com/jupi-z/Monarque-Connect/pull/164) a été fusionnée au commit `cf80f6d251d094b02587d64a842fbf4af8c8c7ef`. La CI PR [#541](https://github.com/jupi-z/Monarque-Connect/actions/runs/40594994400) et la CI post-fusion [#542](https://github.com/jupi-z/Monarque-Connect/actions/runs/40596032467) sont réussies. Aucun schéma, migration ni comportement runtime n'a été modifié par C2.1.

## Preuve C2.2

La PR [#166](https://github.com/jupi-z/Monarque-Connect/pull/166) a été fusionnée au commit `e57e5b4f36660f28234044f14d55ede9df59654f`. La CI PR [#551](https://github.com/jupi-z/Monarque-Connect/actions/runs/40602789649) et la CI post-fusion [#552](https://github.com/jupi-z/Monarque-Connect/actions/runs/40603636573) ont réussi. La CI couvre les migrations depuis une base vide et les upgrades historiques pris en charge, les contraintes PostgreSQL, les 13 scénarios d'intégration C2, les contrats, tests complets et E2E.

## Limites déclarées

Monarque Auth/Keycloak n'est pas déployé ni connecté par C2. Jusqu'à livraison d'un validateur OIDC complet, `OIDC_RUNTIME=NOT_CONFIGURED` et tout flux fédéré réel est `NOT_RUN`. BUYER complet, AGENT runtime, POS, C3–C8 et l'application ZAMUREK restent hors livraison C2.
