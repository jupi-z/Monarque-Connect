# C2 — Identity, Tenancy & Tenant Principals — preuves de clôture technique

Date de vérification : 28 octobre 2026  
Baseline `main` après C2.4 : `bef5d7fa92522f71466b9933917853ed96796dd7`  
Issue de suivi : [#163](https://github.com/jupi-z/Monarque-Connect/issues/163)

## Verdict

**C2 est techniquement livré et validé par ses CI PR et post-fusion.** Le registre d'identités externes est additif, les identifiants internes et l'authentification legacy sont conservés, et les décisions d'autorisation produit C2.3/C2.4 restent fail-closed selon les memberships, permissions, scopes et entitlements stockés côté serveur.

Cette clôture ne vaut pas intégration à un fournisseur OIDC réel, disponibilité des parcours BUYER/AGENT, déploiement de Monarque Auth/Keycloak, ni validation de mise en production.

## Livraisons

| Lot | PR et changement | Preuves |
|---|---|---|
| C2.1 | [PR #164](https://github.com/jupi-z/Monarque-Connect/pull/164), contrat d'identité, acteurs et provenance; merge `cf80f6d251d094b02587d64a842fbf4af8c8c7ef` | CI PR #541 et post-fusion #542, enregistrées dans [Docs/120](120_C2_EXECUTION_STATUS.md) |
| C2.2 — contrats | [PR #165](https://github.com/jupi-z/Monarque-Connect/pull/165), règles du registre et des challenges; merge `e52c57658af66a1b2f905dd84ebe81b08d4a7822` | CI PR #545 et post-fusion #546, [Docs/120](120_C2_EXECUTION_STATUS.md) |
| C2.2 — persistance | [PR #166](https://github.com/jupi-z/Monarque-Connect/pull/166), registre `ExternalIdentity`, liaison/révocation/audit; merge `e57e5b4f36660f28234044f14d55ede9df59654f` | [CI PR #551](https://github.com/jupi-z/Monarque-Connect/actions/runs/40602789649), [CI main #552](https://github.com/jupi-z/Monarque-Connect/actions/runs/40603636573) |
| C2.3 | [PR #167](https://github.com/jupi-z/Monarque-Connect/pull/167), provenance d'identité et autorisation scoped par produit; merge `62a52873b4a3c15c996cd53fddea4028af4fb759` | [CI PR #555](https://github.com/jupi-z/Monarque-Connect/actions/runs/40605245638), [CI main #556](https://github.com/jupi-z/Monarque-Connect/actions/runs/40606106358) |
| C2.4 | [PR #168](https://github.com/jupi-z/Monarque-Connect/pull/168), preuves de sécurité/compatibilité; head final `7204fb485225dbb635e2c71c2f5a2de58ee45d47`, merge `bef5d7fa92522f71466b9933917853ed96796dd7` | [CI PR #558](https://github.com/jupi-z/Monarque-Connect/actions/runs/40607760628), [CI post-fusion main #559](https://github.com/jupi-z/Monarque-Connect/actions/runs/40608585529) |

Les merges C2.2 ont ajouté deux migrations : `20261028090000_c2_external_identity_audit_actions` et `20261028090100_c2_external_identity_tables`. C2.3 et C2.4 n'ont ajouté aucune migration. Les CI de migration ont validé 58 migrations depuis une base vide ainsi que les états historiques pris en charge.

## Contrôles finaux vérifiés sur le SHA de PR C2.4 et le merge main

La CI #558 sur la tête finale et la CI #559 sur `main@bef5d7f` ont chacune réussi le workflow Backend CI complet. Les journaux #559 confirment :

- Preuve de migration Phase 10A.5 réussie : base vide (58 migrations), upgrade Phase 9.6 et upgrade depuis le main antérieur, avec préservation des lignes historiques.
- Prisma, contrats, OpenAPI (200 opérations) et validation des exemples de contrats réussis.
- Unitaires : 45 fichiers, 182 tests réussis.
- Intégration PostgreSQL : 46 fichiers, 209 tests réussis.
- E2E HTTP : 10 fichiers, 28 tests réussis.
- Répétitions CRM et Phase 1 dans les deux ordres, build de production, smoke HTTP et nettoyage de PostgreSQL réussis.

Les scénarios C2 couverts incluent liaison issuer/subject, absence de liaison par email, révocation et unicité, compatibilité des sessions legacy, dérivation STAFF depuis membership serveur, refus d'accès inter-tenant, séparation des entitlements produits, contrôle du scope établissement, suspension produit isolée et priorité de la suspension globale.

## Échec observé et correction

Le premier run de la PR C2.4, [#557](https://github.com/jupi-z/Monarque-Connect/actions/runs/40607134494), a échoué sur la nouvelle fixture PostgreSQL : elle tentait de créer un second établissement alors que l'organisation de test disposait de la capacité par défaut d'un seul. Le refus `Quota capacity exceeded` était le comportement métier attendu. La fixture a été corrigée en ajoutant, avant l'opération testée, un override de capacité limité à deux établissements. Aucun code métier, quota, permission ni assertion de sécurité n'a été assoupli. Le run #558 sur le SHA final et le run post-fusion #559 ont tous deux réussi.

## État fonctionnel et limites

- `User.id`, memberships, JWT et refresh sessions historiques sont conservés.
- Le mapping durable exact `(issuer, subject) → User.id` ne rapproche jamais les comptes par email.
- `AuthGuard` authentifie uniquement l'identité interne issue de la session legacy; il ne déduit pas STAFF.
- STAFF est dérivé d'un membership actif et vérifié côté serveur. Les méthodes product-scoped ne retombent pas silencieusement sur Connect.
- PLATFORM conserve une autorisation distincte et limitée; elle ne fournit pas de bypass général tenant.
- Le port OIDC interne reste non enregistré, sans validateur ni route runtime. `OIDC_RUNTIME=NOT_CONFIGURED` et fédération réelle `NOT_RUN`.
- BUYER et AGENT n'ont pas d'authenticator runtime livré; leurs parcours restent `PLANNED`.
- Monarque Auth/Keycloak, POS, ZAMUREK runtime, C3–C8 et production sont hors de C2.
- Aucune adaptation de code ou de contrat runtime n'a été faite dans le dépôt ZAMUREK; sa PR documentaire #2 reste indépendante.

La clôture atteste les contrôles techniques cités sur les SHA indiqués. Elle ne constitue ni un audit de sécurité externe ni une preuve d'intégration OIDC ou de conformité opérationnelle.
