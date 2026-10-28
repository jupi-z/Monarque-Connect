# C2 — Identity, Tenancy & Tenant Principals — statut

**C0 :** clôturé et suivi dans l'issue #153.
**C1 :** clôturé; les PR #158–#162 et la CI post-fusion #540 sont vérifiées.
**C2 : TECHNIQUEMENT LIVRÉ — C2.1 à C2.4 fusionnés; clôture documentaire en cours.** Issue de suivi : [#163](https://github.com/jupi-z/Monarque-Connect/issues/163).
**Dernière baseline fonctionnelle validée :** `main@bef5d7fa92522f71466b9933917853ed96796dd7`; CI post-fusion #559 [réussie](https://github.com/jupi-z/Monarque-Connect/actions/runs/40608585529).

| Lot | État | Gate |
|---|---|---|
| C2.1 — Contrats d'identité, acteurs et provenance | DONE | PR [#164](https://github.com/jupi-z/Monarque-Connect/pull/164), head `8100c2429468a623708f1e9b08cc2c9147ed5e6f`, merge `cf80f6d251d094b02587d64a842fbf4af8c8c7ef`, CI PR [#541](https://github.com/jupi-z/Monarque-Connect/actions/runs/40594994400) et post-fusion #542 |
| C2.2 — Contrat exact du registre et des challenges | DONE | PR [#165](https://github.com/jupi-z/Monarque-Connect/pull/165), merge `e52c57658af66a1b2f905dd84ebe81b08d4a7822`, CI PR [#545](https://github.com/jupi-z/Monarque-Connect/actions/runs/40597595319) et post-fusion #546 |
| C2.2 — Registre ExternalIdentity et migration additive | DONE | PR [#166](https://github.com/jupi-z/Monarque-Connect/pull/166), head `99b27a135486edf492bb640066acda88cd9352a2`, merge `e57e5b4f36660f28234044f14d55ede9df59654f`; CI PR [#551](https://github.com/jupi-z/Monarque-Connect/actions/runs/40602789649), post-fusion #552 verte; 58 migrations depuis base vide et upgrades historiques, 13 tests PostgreSQL C2, concurrence et audit/Outbox validés |
| C2.3 — Provenance identité, acteurs et autorisation produit | DONE | PR [#167](https://github.com/jupi-z/Monarque-Connect/pull/167), head `d6b4445a21c3e722713d5a3ecd9811495476e12f`, merge `62a52873b4a3c15c996cd53fddea4028af4fb759`; CI PR #555 et post-fusion #556 vertes |
| C2.4 — Durcissement et preuves | DONE | PR [#168](https://github.com/jupi-z/Monarque-Connect/pull/168), head `7204fb485225dbb635e2c71c2f5a2de58ee45d47`, merge `bef5d7fa92522f71466b9933917853ed96796dd7`; CI PR [#558](https://github.com/jupi-z/Monarque-Connect/actions/runs/40607760628) et post-fusion [#559](https://github.com/jupi-z/Monarque-Connect/actions/runs/40608585529) vertes |

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

## Preuve C2.3

La PR [#167](https://github.com/jupi-z/Monarque-Connect/pull/167) a été fusionnée au commit `62a52873b4a3c15c996cd53fddea4028af4fb759`. La CI PR #555 [a réussi](https://github.com/jupi-z/Monarque-Connect/actions/runs/40605245638) sur la tête `d6b4445a21c3e722713d5a3ecd9811495476e12f`; la CI post-fusion #556 [a réussi](https://github.com/jupi-z/Monarque-Connect/actions/runs/40606106358) sur le SHA de `main`. Les tests unitaires correspondants ont passé (45 fichiers, 181 tests), l'ensemble des tests unitaires 46 fichiers/208 tests, et les E2E 10 fichiers/28 tests; répétitions de stabilité, build et smoke HTTP ont également été exécutés par ce workflow.

## Preuve C2.4

La PR [#168](https://github.com/jupi-z/Monarque-Connect/pull/168) a été fusionnée par squash au commit `bef5d7fa92522f71466b9933917853ed96796dd7`. Sa tête finale était `7204fb485225dbb635e2c71c2f5a2de58ee45d47`. La CI PR [#558](https://github.com/jupi-z/Monarque-Connect/actions/runs/40607760628) et la CI post-fusion sur `main` [#559](https://github.com/jupi-z/Monarque-Connect/actions/runs/40608585529) ont réussi.

Les contrôles hébergés ont validé 58 migrations depuis une base vide ainsi que les upgrades historiques pris en charge, OpenAPI (200 opérations), contrats, 45 fichiers/182 tests unitaires, 46 fichiers/209 tests d'intégration PostgreSQL, 10 fichiers/28 tests E2E, répétitions CRM/Phase 1 dans les deux ordres, build et smoke HTTP. La fixture de scope établit explicitement un override de capacité à deux établissements; les quotas et le code métier n'ont pas été changés. Le premier run PR #557 avait révélé l'absence de cette capacité dans la fixture et a échoué avant E2E/build; ce résultat est conservé comme preuve de correction, pas masqué par un rerun.

La PR C2.4 n'a pas introduit de migration. La CI post-fusion confirme la version désormais sur `main`.

## Limites déclarées

Monarque Auth/Keycloak n'est pas déployé ni connecté par C2. Jusqu'à livraison d'un validateur OIDC complet, `OIDC_RUNTIME=NOT_CONFIGURED` et tout flux fédéré réel est `NOT_RUN`. BUYER complet, AGENT runtime, POS, C3–C8 et l'application ZAMUREK restent hors livraison C2.
