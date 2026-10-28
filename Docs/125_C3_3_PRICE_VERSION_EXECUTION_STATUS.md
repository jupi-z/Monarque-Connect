# C3.3.1 — Prix commerciaux versionnés: état d'exécution

**Statut: implémentation candidate, validation GitHub-hosted en attente.** Ce document décrit le périmètre proposé de la première tranche C3.3. Il ne déclare ni migration validée, ni parcours de cotation terminé, ni C3.3/C3 clôturé.

## Baseline

- `main`: `909764d461991489250b5da1caf673d209ebfef8`.
- Backend CI post-fusion C3.2: run [40650502528](https://github.com/jupi-z/Monarque-Connect/actions/runs/40650502528), conclusion `success` sur le SHA de cette baseline.
- Branche candidate: `monarque/c3-pricing-fx`.
- Contrat normatif: [Docs/122](122_C3_SHARED_CATALOG_PRICING_MEASURES_FX_CONTRACT.md).

## Périmètre de C3.3.1

- Ajouter `CommercialPriceVersion`, distinct de FairScale `PriceVersion`, avec FK composite vers l'offre et le produit serveur-scopé, montant `NUMERIC(24,8)`, devise, unité compatible, ordre de version, instant d'effet, auteur et empreinte de commande.
- Publier par `POST /organizations/{organizationId}/catalog/offers/{offerId}/price-versions`. Le produit est dérivé de l'offre tenant-scopée; aucun montant final n'est fourni par une interface de vente. Les prix rétrodatés sont refusés et une version publiée est immuable.
- Autoriser la publication par `pricing:price:publish`, séparée de `catalog:write` et des permissions de calcul/lire des cotations; revalider permission, entitlements et scope d'établissement dans la transaction.
- Sérialiser la concurrence au verrou de l'offre; rendre les commandes idempotentes par acteur/tenant/opération/clé et rejeter un rejeu divergent avec `409`.
- Écrire la version, le reçu d'idempotence, l'audit et un événement Outbox minimisé dans une transaction unique. L'événement ne porte ni montant ni donnée personnelle.
- Ajouter `calculateCommercialPrice` comme primitive pure utilisant un constructeur Decimal isolé, conversion rationnelle d'unités, `HALF_UP` à la frontière de devise et validation fail-closed des codes, précisions et taux FX. Cette fonction ne représente pas encore le Pricing Engine complet.

## Contrôles candidats

- Tests PostgreSQL/HTTP pour permission refusée, tenant étranger, établissement hors scope, rejeu identique/divergent, échéance passée, dimension d'unité incompatible, concurrence, atomicité audit/Outbox et blocage SQL de modification/suppression.
- Tests unitaires Decimal pour `125 g × 20 USD/kg × 2360 CDF/USD = 5900.00 CDF`, arrondi, quantité/unité invalide et taux nul.
- Preuve de migration depuis base vide et les états historiques pris en charge, avec inspection des FK, contraintes, index et triggers d'immuabilité.
- OpenAPI runtime pour la route; contrat C3 proposé conservé séparément tant que les endpoints correspondants ne sont pas livrés.

## État des validations

| Contrôle | État |
|---|---|
| Tests ciblés locaux | `NOT_RUN`: Vitest n'est pas installé dans ce worktree; la commande ciblée n'a pas démarré. Aucun résultat de test n'est revendiqué localement. |
| Prisma validate/generate, lint, typecheck, contrats, OpenAPI, PostgreSQL, E2E, build et smoke HTTP | `NOT_RUN`: à exécuter sur GitHub-hosted par CI PR. |
| CI PR / CI post-fusion | `NOT_RUN`: aucun SHA de candidat publié/validé au moment de cette note. |
| Déploiement ou validation production | `NOT_RUN` et hors périmètre. |

## Limites et suite

Cette tranche ne fournit pas encore la persistance ni les opérations de `PricingPolicyVersion`, `TaxPolicyVersion`, `FxRate`, `PricingQuote`, `PricingQuoteLine` ou `PricingQuoteRevocation`. Elle ne configure aucun fournisseur FX, ne déclare aucune conformité fiscale, ne remplace pas les anciens calculs Sales/Billing et ne réalise aucune transaction POS. Ces points restent ouverts dans C3.3/C3.4 et doivent être livrés avant toute clôture C3.
