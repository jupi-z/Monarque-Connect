# C3.3.1 — Prix commerciaux versionnés: état d'exécution

**Statut: implémentation candidate, CI corrective en cours.** Ce document décrit le périmètre proposé de la première tranche C3.3. Il ne déclare ni migration validée, ni parcours de cotation terminé, ni C3.3/C3 clôturé.

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
| CI PR `#175`, SHA `422a73e060d840048ab8f88ab5b6925da41aea5d` | `FAILURE`: [run 40654523289](https://github.com/jupi-z/Monarque-Connect/actions/runs/40654523289), job `validate-pr / validate`. Prisma `generate` a refusé le nom de l'index `commercial_price_versions_org_product_offer_currency_effective_idx`, supérieur à la limite PostgreSQL de 63 octets. `validate-main` a été `SKIPPED`. |
| Correction de l'index | Renommage cohérent en `commercial_price_versions_price_scope_time_idx` dans le schéma Prisma, la migration et la preuve structurelle SQL. Le run 40654853484 a ensuite atteint l'étape lint après Prisma generate; le problème de longueur d'index n'y est donc plus présent. |
| CI PR `#175`, SHA `1aff84d06130c1f5c3646aa1d4be6ce520dc1264` | `FAILURE`: [run 40654853484](https://github.com/jupi-z/Monarque-Connect/actions/runs/40654853484), annotation ESLint `no-unsafe-assignment` sur l'assertion de schéma `PositiveCommercialPriceAmount`. Les vérifications précédentes du même job ont atteint le lint; l'échec n'est pas masqué. |
| Correction du contrat de test | L'assertion remplace `expect.any(String)` par le motif décimal attendu explicitement; aucune assertion n'est retirée. La validation GitHub-hosted du nouveau SHA reste `PENDING`. |
| CI PR `#175`, SHA `10c5f861b7914ef30ebcbbf326354d35d7c19f91` | `FAILURE`: [run 40655378569](https://github.com/jupi-z/Monarque-Connect/actions/runs/40655378569), typecheck: `productCode` passé comme `string` au resolver scoped, et `organizationId` invalide dans la création imbriquée de `MembershipEstablishmentScope`. |
| Correction du type et de la fixture | Le type `ProductCode` validé est conservé dans les deux appels d'autorisation; le scope nested create laisse Prisma déduire l'organisation via le parent membership. La CI du nouveau SHA reste `PENDING`. |
| CI PR `#175`, SHA `b5b2e4fac45664d48f6c8c5aa7bb2732fb8d73bb` | `FAILURE`: [run 40655780607](https://github.com/jupi-z/Monarque-Connect/actions/runs/40655780607). Les migrations ont été appliquées depuis une base vide et par upgrade; la preuve structurelle a échoué car son contrôle cherchait un ancien texte de diagnostic plutôt que la condition réellement définie dans le trigger. Le job a arrêté les contrôles suivants et a nettoyé le conteneur PostgreSQL. |
| Correction de la preuve structurelle | Le vérificateur recherche maintenant l'expression SQL effective `NEW.effective_from <= latest_effective_from`, le verrou d'offre et le message de rejet du trigger. Aucun contrôle SQL n'est retiré. CI du SHA correctif `PENDING`. |
| CI PR `#175`, SHA `e7f46ffebb90dd60c7e8e03d638b211a2cea9d0e` | `FAILURE`: [run 40656236842](https://github.com/jupi-z/Monarque-Connect/actions/runs/40656236842). La preuve migration, le typecheck et les tests unitaires sont passés; deux tests PostgreSQL ont révélé que `catalog_command_receipts_resource_type_check` n'autorisait pas le nouveau type `CommercialPriceVersion`. Les publications HTTP échouaient donc en 500 (`23514`), y compris les commandes concurrentes. |
| Correction du registre de reçus | La contrainte de la migration C3 non fusionnée autorise maintenant explicitement `CommercialPriceVersion`, et la preuve structurelle vérifie la contrainte PostgreSQL. La migration historique déjà livrée n'est pas modifiée. La suite PostgreSQL et CI complète du nouveau SHA restent `PENDING`. |
| CI post-fusion | `NOT_RUN`: la PR n'est pas fusionnée. |
| Déploiement ou validation production | `NOT_RUN` et hors périmètre. |

## Limites et suite

Cette tranche ne fournit pas encore la persistance ni les opérations de `PricingPolicyVersion`, `TaxPolicyVersion`, `FxRate`, `PricingQuote`, `PricingQuoteLine` ou `PricingQuoteRevocation`. Elle ne configure aucun fournisseur FX, ne déclare aucune conformité fiscale, ne remplace pas les anciens calculs Sales/Billing et ne réalise aucune transaction POS. Ces points restent ouverts dans C3.3/C3.4 et doivent être livrés avant toute clôture C3.
