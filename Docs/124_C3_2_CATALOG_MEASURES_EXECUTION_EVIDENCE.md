# C3.2 — Catalogue, variantes, offres et mesures — état d'exécution

**État : IN PROGRESS / NOT VALIDATED.** Ce document suit l'implémentation candidate de C3.2. Il ne constitue pas une preuve de migration appliquée, de tests réussis, de CI verte ou de livraison fusionnée. Les preuves seront ajoutées après exécution par GitHub-hosted Actions sur le SHA exact de la PR et après validation de la CI post-fusion.

## Baseline et périmètre

- Baseline contractuelle C3.1 : `main@32fdfb721f70312eda7a4f5cbfb13cda6a9aeecf`.
- CI baseline observée : [Backend CI #40641031758](https://github.com/jupi-z/Monarque-Connect/actions/runs/40641031758), succès sur ce SHA.
- Suivi C3 : [issue #171](https://github.com/jupi-z/Monarque-Connect/issues/171).
- Contrat normatif : [Docs/122](122_C3_SHARED_CATALOG_PRICING_MEASURES_FX_CONTRACT.md).
- Migration candidate : `20261028110000_c3_catalog_measures_offers`.

C3.2 couvre le registre versionné des mesures, un allowlist de métadonnées ISO 4217, les variantes d'Items, les offres commerciales tenant/produit scoped et les commandes REST auditées/idempotentes. `Item` reste canonique. `Organization.defaultCurrency`, les prix historiques, Sales, Purchases, les ledgers Inventory et FairScale Billing ne sont pas réécrits. Cette tranche n'ajoute aucun prix versionné, politique commerciale de calcul, moteur FX, fournisseur de taux, snapshot de transaction, intégration POS ou fiscalisation : ces livrables sont réservés à C3.3 ou à des phases ultérieures.

## Modèles et intégrité candidate

- `MeasureUnit` : code, dimension, unité de base, facteur rationnel positif, version et provenance de registre. Les unités de base sont auto-référentes et canoniques; aucune conversion entre dimensions différentes n'est permise.
- `CurrencyDefinition` : code ISO alphabétique, nombre de décimales mineures, version et provenance. La première allowlist limitée à CDF, EUR et USD conserve deux décimales. Elle ne modifie aucune devise d'organisation ni montant historique.
- `ItemVariant` : variante tenant-scoped attachée au même Item et à la même organisation par FK composite. Elle ne duplique pas Item et n'invente pas d'appartenance produit.
- `CommercialOffer` : référence un Item, une variante éventuelle, une unité de vente, un produit et éventuellement un établissement/canal. Des FK composites empêchent les références inter-tenants. La version optimiste est incrémentée par modification; aucun prix n'est stocké dans ce modèle.
- `CatalogCommandReceipt` : empreinte SHA-256 de la commande et unicité PostgreSQL par organisation, acteur, opération et clé. La mutation, le reçu, l'audit et l'Outbox sont écrits dans la transaction.

Le DDL est additif. Les valeurs de mesure sont des rapports rationnels exacts à une version interne `monarque-measures-v1`. L'allowlist devise référence l'ISO 4217 List One de l'agence de maintenance SIX (`six-iso4217-list-one-2026-10`); l'agence publie les listes courantes et leurs amendements sur [sa page officielle des standards](https://www.six-group.com/en/products-services/financial-information/market-reference-data/data-standards.html). La présence de cette source ne vaut ni validation fiscale, ni taux FX, ni choix de devise commerciale.

## API et contrôles applicatifs candidats

- `GET /catalog/measure-units` et `GET /catalog/currencies` exigent une authentification et ne divulguent que les registres actifs versionnés.
- Les variantes et offres exigent un principal `STAFF`, un module `CATALOG` autorisé pour le `productCode`, les permissions centralisées, le membership du tenant et le scope d'établissement.
- Les identifiants d'organisation, d'établissement, de produit et d'acteur sont vérifiés côté serveur; un Item étranger est masqué par réponse 404.
- Les listes d'offres excluent les offres inactives ainsi que celles rattachées à des Items ou variantes inactifs. Les offres globales sont visibles dans un canal précis; les offres d'un autre canal ne le sont pas.
- Les changements d'offre utilisent `expectedVersion`; un conflit concurrent attendu répond 409.
- Les événements et audits ne contiennent pas de montant ni de donnée personnelle de variante. Les écritures sont atomiques à la mutation.

La conversion de quantité emploie `BigInt` et des facteurs rationnels. L'entrée est strictement positive, limitée à 12 décimales fractionnaires et à la plage du résultat stockable `NUMERIC(24,12)`. Les conversions non exactes ou dimensionnellement incompatibles sont refusées. Cette précision ne garantit pas qu'une quantité est représentable dans le ledger Inventory historique `DECIMAL(19,6)`; toute future intégration transactionnelle devra contrôler cette conversion sans arrondi implicite. La preuve de tarification `0.125 kg × 20 USD/kg × 2360 CDF/USD = 5900 CDF` demeure un gate C3.3, et n'est pas satisfaite par le seul convertisseur de mesure.

## Validation et preuves

| Contrôle | État au moment de rédaction |
|---|---|
| Inspection statique et `git diff --check` | Réalisée localement; aucune erreur d'espacement signalée |
| Prisma validate/generate | NOT_RUN localement; à exécuter sur GitHub-hosted Actions |
| Lint/typecheck/build | NOT_RUN localement; à exécuter sur GitHub-hosted Actions |
| Tests unitaires exacts de mesure | Ajoutés, NOT_RUN |
| Tests PostgreSQL d'offres, isolation, idempotence et concurrence | Ajoutés, NOT_RUN |
| Test HTTP non authentifié des registres et contrats OpenAPI | Ajouté, NOT_RUN |
| Migration depuis base vide et états historiques supportés | Script de preuve étendu, NOT_RUN |
| CI PR et CI post-fusion | NOT_RUN; aucun PR/commit de livraison n'est encore enregistré |

Aucune preuve de migration appliquée, de base de production ou d'exécution runtime n'est revendiquée. Les références d'exécution seront inscrites ici seulement après lecture des conclusions GitHub Actions sur le SHA correspondant.

## Suite

Avant de créer la PR, terminer la revue statique du DDL, de l'OpenAPI, des tests et du script de migration. Puis exécuter tous les gates applicables sur GitHub-hosted Actions. Ne commencer C3.3 qu'après fusion contrôlée et CI post-fusion verte sur `main`.
