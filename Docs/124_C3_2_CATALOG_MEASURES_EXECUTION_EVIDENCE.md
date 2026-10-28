# C3.2 — Catalogue, variantes, offres et mesures — état d'exécution

**État : MERGED / POST-MERGE CI VERIFIED.** La PR #174 est fusionnée dans `main@909764d461991489250b5da1caf673d209ebfef8`; la Backend CI post-fusion #583, run [40650502528](https://github.com/jupi-z/Monarque-Connect/actions/runs/40650502528), est terminée avec `success` sur ce SHA.

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
- Le reset PostgreSQL des tests conserve les deux registres système versionnés (`measure_units`, `currency_definitions`) créés par migration. Les données tenant restent réinitialisées; les fixtures ne doivent pas effacer les référentiels immuables partagés.

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
| SHA candidat vérifié | `a1e38498206b05694b030dfb4716f83533eaba02`; run PR a exécuté le merge ref synthétique `faa16a5ca3b39fe9ea5852484eb3ae733a4a85c1` |
| Prisma validate/generate | PASS sur le runner GitHub-hosted; Prisma Client v7.10.0 généré et schéma validé |
| Audit dépendances runtime | PASS: 137 packages de production atteignables; aucune vulnérabilité High/Critical atteignable au runtime. `npm ci` signale 5 advisories totales (1 moderate, 4 high), dont les avis Prisma de développement sont explicitement exclus du graphe runtime par le contrôle dédié |
| Lint/typecheck/build | PASS sur le runner GitHub-hosted |
| Tests unitaires | PASS: 48 fichiers, 193 tests |
| Tests d'intégration PostgreSQL | PASS: 46 fichiers, 216 tests |
| Tests HTTP E2E | PASS: 10 fichiers, 28 tests, base isolée et migrations appliquées |
| Répétabilité CRM / Phase 1 | PASS: dix répétitions de chaque suite, dans les deux ordres; 20 invocations ciblées réussies |
| Migration depuis base vide et upgrades historiques | PASS: 59 migrations depuis zéro; preuves d'upgrade depuis l'état Phase 9.6 (54 migrations) et depuis le `main` de référence; `prisma:deploy` appliqué avec succès |
| OpenAPI et contrats | PASS: 206 opérations OpenAPI principales et 13 opérations proposées C3 validées; validation des contrats réussie |
| Smoke HTTP et nettoyage | PASS: smoke des endpoints health et suppression du conteneur PostgreSQL isolé réussies |
| CI PR | [Backend CI #40646849656](https://github.com/jupi-z/Monarque-Connect/actions/runs/40646849656), run #578, conclusion `success`, sur le head `a1e38498206b05694b030dfb4716f83533eaba02`. Les échecs antérieurs et leur résolution sont conservés dans la ligne ci-dessous. |
| Revalidation de la preuve documentaire | [Backend CI #40647891175](https://github.com/jupi-z/Monarque-Connect/actions/runs/40647891175), run #579, conclusion `success`, sur le head `052fafd7f467cd4cce3268ea50a67d786f0dd65b`; le seul changement depuis le SHA précédent est la consignation des résultats de CI. |
| Revalidation complète après synchronisation des preuves | [Backend CI #40648514831](https://github.com/jupi-z/Monarque-Connect/actions/runs/40648514831), run #580, conclusion `success`, sur le head `2e3c5bb583c8a47eeb118d8573020eeacc8832d4`. |
| CI complète du candidat final C3.2 | [Backend CI #40649204260](https://github.com/jupi-z/Monarque-Connect/actions/runs/40649204260), run #581, conclusion `success`, sur le head `49e96bbc78ac0a429a09a056e481efff54a25a7f`. |
| CI post-fusion | PASS: [Backend CI #583 / run 40650502528](https://github.com/jupi-z/Monarque-Connect/actions/runs/40650502528), conclusion `success`, SHA `909764d461991489250b5da1caf673d209ebfef8` |

Les échecs antérieurs ont été corrigés de manière ciblée: [#40645157199](https://github.com/jupi-z/Monarque-Connect/actions/runs/40645157199) lint; [#40645436513](https://github.com/jupi-z/Monarque-Connect/actions/runs/40645436513) typecheck; [#40645716729](https://github.com/jupi-z/Monarque-Connect/actions/runs/40645716729) lint; [#40645899634](https://github.com/jupi-z/Monarque-Connect/actions/runs/40645899634) migration (`jsonb_object_length` non disponible, remplacé par le comptage JSONPath testé); [#40646173196](https://github.com/jupi-z/Monarque-Connect/actions/runs/40646173196) reset global qui supprimait les deux registres système. La CI verte #40646849656 confirme la correction de ces défauts de validation sur son SHA exact.

Aucune preuve de migration appliquée sur production ou d'exécution runtime déployée n'est revendiquée. Les cinq advisories signalés par `npm ci` sont toujours recensés; le contrôle de dépendances runtime a réussi, mais cela ne signifie pas que l'audit complet du graphe de développement est exempt d'advisories. Les preuves CI PR ci-dessus concernent exclusivement les SHA de PR indiqués. La CI post-fusion #583 apporte la preuve distincte que le commit résultant sur `main` a été validé; elle ne constitue pas une preuve de déploiement en production.

## Suite

La révision candidate finale `49e96bb` a été fusionnée par la PR #174. Le SHA merge `909764d` a passé la CI post-fusion #583. C3.3 peut s'appuyer sur cette baseline; aucune activité C4 n'est incluse.
