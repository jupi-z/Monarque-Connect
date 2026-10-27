# C2 — Identity, Tenancy & Tenant Principals — statut

**C0 :** clôturé et suivi dans l'issue #153.
**C1 :** clôturé; les PR #158–#162 et la CI post-fusion #540 sont vérifiées.
**C2 : IN_PROGRESS — C2.1 contrat en préparation.** Issue de suivi : [#163](https://github.com/jupi-z/Monarque-Connect/issues/163).
**Dernière baseline contrôlée :** `main@e34e9fa0d7c92cd0ae69a82d1b39110906fbaec3`; CI [#540](https://github.com/jupi-z/Monarque-Connect/actions/runs/40566992869) réussite sur ce SHA.

| Lot | État | Gate |
|---|---|---|
| C2.1 — Contrats d'identité, acteurs et provenance | IN_PROGRESS | Revue et CI documentaire sur la branche C2 |
| C2.2 — Registre ExternalIdentity et migration additive | PLANNED | PostgreSQL, migration empty DB + upgrades, concurrence, audit/Outbox |
| C2.3 — Contexte principal et port d'identité fédérée | PLANNED | Compatibilité legacy, tenants, produit, scopes, refus BUYER/AGENT non configurés |
| C2.4 — Durcissement et preuves | PLANNED | E2E/sécurité, CI post-fusion, preuve et issue #163 |

## État réel à la baseline

- Auth legacy : `AuthPrincipal` contient `userId` et `sessionId`; le JWT garde `sub`/`sid`; `AuthGuard` vérifie une refresh session active et un utilisateur actif.
- STAFF : `AuthorizationService` résout le membership et le scope depuis PostgreSQL. Les permissions et entitlements sont vérifiés côté serveur; C1 conserve les resolvers legacy Connect et les variantes explicitement scoped par produit.
- PLATFORM : accès existant via `PlatformAuthorizationService`; C2 ne lui accorde pas de bypass de tenant.
- Aucun modèle `issuer + subject`, challenge de liaison, port OIDC, principal BUYER, authenticator AGENT ni flux de fédération runtime n'existe à cette baseline.
- La table `User` exige actuellement un `passwordHash`; C2 ne modifie pas le modèle ni le login legacy et n'ajoute aucun utilisateur fédéré autonome.
- La migration courante est `20261027170000_c1_product_module_scope`. C2 ne réécrit aucune migration fusionnée.

## Limites déclarées

Monarque Auth/Keycloak n'est pas déployé ni connecté par C2. Jusqu'à livraison d'un validateur OIDC complet, `OIDC_RUNTIME=NOT_CONFIGURED` et tout flux fédéré réel est `NOT_RUN`. BUYER complet, AGENT runtime, POS, C3–C8 et l'application ZAMUREK restent hors livraison C2.
