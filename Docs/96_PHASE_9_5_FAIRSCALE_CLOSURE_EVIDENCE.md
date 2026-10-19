# 96 — Preuves de clôture Phase 9.5 FairScale V1

**Statut : CLÔTURÉE — 19/10/2026**  
**Périmètre : catalogue USD, pricing déterministe, promotions de devis, capacités et identité de facturation préparatoire.**  
**Phase 9.6 : non commencée ; aucun paiement réel ni activation payante n'est déclaré.**

## Décision

La Phase 9.5 est clôturée techniquement et documentairement. Les gates de la matrice Docs/92 relevant de 9.5 sont couverts par du code versionné, des migrations additives, des tests PostgreSQL/E2E, la CI PR et la CI post-fusion sur `main`.

Cette clôture ne signifie pas que Monarque encaisse déjà des paiements. Les paiements vérifiés, les factures SaaS, les renouvellements, les remboursements, les webhooks et l'activation commerciale appartiennent à la Phase 9.6.

## Provenance Git et CI

| Élément | Preuve |
|---|---|
| Baseline avant les gates finaux | `main@2f5f3b19e498aa0135fe31e22b30b4d251c8b5fb` |
| PR finale d'implémentation/gates | [PR #129](https://github.com/jupi-z/Monarque-Connect/pull/129) |
| Fusion des gates FairScale | `aab7310aadce772385e5d55cac1cedf0300a7628` |
| CI PR des gates FairScale | [Backend CI #39246848898](https://github.com/jupi-z/Monarque-Connect/actions/runs/39246848898) — success |
| PR de reproductibilité CI locale | [PR #130](https://github.com/jupi-z/Monarque-Connect/pull/130) |
| CI PR du durcissement CI | [Backend CI #39254154732](https://github.com/jupi-z/Monarque-Connect/actions/runs/39254154732) — success |
| `main` après fusion documentaire CI | `0fb133fdfc4a6eb6e1a76389e4eb0bd203a976dd` |
| CI post-fusion finale de `main` | [Backend CI #39254936153](https://github.com/jupi-z/Monarque-Connect/actions/runs/39254936153) — success |

La branche de travail de la PR #130 a été supprimée du dépôt distant après fusion. `main` est la seule branche distante conservée.

## Gates fonctionnels prouvés

- Catalogue USD versionné et prix en cents : CONNECT gratuit, OPERATIONS, BUSINESS et ENTERPRISE ; add-ons mensuels/annuels.
- Calcul serveur déterministe des devis et snapshots de prix/remises, sans source de vérité monétaire côté navigateur.
- `WELCOME_MONTHLY15` limité à trois échéances mensuelles admissibles, avec identité `BillingCustomer` et historique durable.
- `ANNUAL20` appliquée au forfait annuel sans remise des add-ons.
- Capacités d'établissements `1/1/3/10`, réservations atomiques et concurrence contrôlée.
- Les abonnements payants ne sont pas bloqués par un plafond commercial `MAX_USERS`; les garde-fous gratuits CONNECT et les contrôles RBAC restent actifs.
- Création concurrente du premier `BillingCustomer` sérialisée, avec une seule identité et une seule attribution de bienvenue.
- Les versions historiques EUR/Phase 2 restent conservées et inchangées.
- Aucune activation de droit payant à partir d'un simple devis ou d'une réponse frontend.

## Preuves automatisées

La CI PR #129 et la CI post-fusion #39254936153 exécutent les preuves de migrations et de non-régression. La preuve Phase 9.5 confirme explicitement :

- base vide : 46 migrations ;
- upgrade depuis Phase 9 : 45 migrations historiques + 1 migration FairScale additive ;
- seed rejouable et catalogue USD vérifié ;
- versions historiques EUR conservées ;
- absence de fixtures opérationnelles introduites par le seed.

La CI finale de `main` confirme également :

- 80 fichiers de tests et 294 tests réussis ;
- 8 fichiers E2E et 16 tests réussis ;
- 182 opérations OpenAPI valides ;
- contrats, lint, typecheck, build et smoke HTTP réussis ;
- migration Phase 9 / Phase 9.5 exécutée avec succès.

Le miroir local `npm run ci:local` a été exécuté sur Windows avec Docker PostgreSQL et une base `monarque_connect_test` recréée à chaque run. Il a reproduit la séquence complète : audit runtime, lint, typecheck, toutes les preuves de migration, déploiement des 46 migrations, OpenAPI, contrats, 294 tests, 16 E2E et build.

## Limites explicites et suite

La Phase 9.5 ne livre pas :

- de fournisseur de paiement réel ou de webhook accepté ;
- de facture SaaS émise ou de paiement vérifié ;
- de renouvellement automatique, remboursement, prorata facturé ou changement de plan payant activé ;
- de commande Control Plane complète pour l'administration Billing.

Ces éléments restent les gates de la Phase 9.6, suivie dans l'issue #123. La Phase 10 ne doit être ouverte qu'après cadrage et exécution selon la roadmap, sans considérer la présente clôture comme une validation de production financière ou réglementaire.
