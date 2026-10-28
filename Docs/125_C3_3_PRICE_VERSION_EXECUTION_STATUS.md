# C3.3 — Prix commerciaux versionnés et registre FX: état d'exécution

**Statut: C3.3.1 et C3.3.2 livrés; le moteur de cotation C3.3 reste en cours.** Ce document conserve l’historique des validations et ne déclare ni le moteur complet de cotation terminé, ni C3.3/C3 clôturé.

## Baseline

- Baseline initiale C3.3: `main@909764d461991489250b5da1caf673d209ebfef8`.
- `main` après fusion C3.3.1: `1a1970504c5a8b7976740c620060292bf37aa408`.
- `main` après fusion C3.3.2 FX: `ab3d99a3507d3d24c089b071f01e9d7094996305`; CI post-fusion #40665166818 réussie.
- Backend CI post-fusion C3.2: run [40650502528](https://github.com/jupi-z/Monarque-Connect/actions/runs/40650502528), conclusion `success` sur le SHA de cette baseline.
- Branches livrées: `monarque/c3-pricing-fx` (PR #175) et `monarque/c3-fx-policy-registry` (PR #176).
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

Les lignes d'échec ci-dessous sont l'historique des itérations de la PR #175 au moment où chaque SHA a été testé. Le résultat final C3.3.1 documenté après ce journal fait foi pour sa clôture; aucun résultat antérieur n'est effacé.

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

## Résultat final C3.3.1

- PR [#175](https://github.com/jupi-z/Monarque-Connect/pull/175) fusionnée; merge commit `1a1970504c5a8b7976740c620060292bf37aa408`.
- CI PR réussie sur le head final, run [40657030191](https://github.com/jupi-z/Monarque-Connect/actions/runs/40657030191); CI post-fusion réussie sur `main`, run [40657980533](https://github.com/jupi-z/Monarque-Connect/actions/runs/40657980533).
- La migration ajoutée, le contrat runtime et la primitive de calcul commercial sont livrés. Ce lot ne livre pas encore les policies, le service de cotation, les snapshots de cotation ni l'utilisation commerciale d'un taux FX.
- Les tests locaux restent `NOT_RUN`; les preuves de migration, tests et build proviennent des exécutions GitHub Actions indiquées.

## C3.3.2 — Registre de taux FX

- PR [#176](https://github.com/jupi-z/Monarque-Connect/pull/176) fusionnée; SHA `ab3d99a3507d3d24c089b071f01e9d7094996305` (implémentation finale issue du SHA de code `1771207227a090d694392378d7cd598dbaba6c70`).
- Périmètre: ingestion plateforme allowlistée, taux Decimal immuable, reçus idempotents, audit et Outbox atomiques, sans fournisseur FX externe ni moteur de cotation.
- CI PR réussie sur le head final `7e6ec7721e3208dba7e50837847af9dce7230324`: [run 40664290224](https://github.com/jupi-z/Monarque-Connect/actions/runs/40664290224). CI post-fusion réussie sur `main@ab3d99a3507d3d24c089b071f01e9d7094996305`: [run 40665166818](https://github.com/jupi-z/Monarque-Connect/actions/runs/40665166818). La validation couvre Prisma, migrations historiques et depuis zéro, OpenAPI, contrats, tests unitaires, PostgreSQL, E2E HTTP, répétitions CRM/Phase 1, build, smoke HTTP et nettoyage du conteneur isolé.
- Itérations antérieures conservées: les runs [40662535049](https://github.com/jupi-z/Monarque-Connect/actions/runs/40662535049) et [40662838967](https://github.com/jupi-z/Monarque-Connect/actions/runs/40662838967) ont détecté successivement un import Vitest `expect` manquant puis un import TypeScript inutilisé de `CommercialPriceService`. Les deux défauts ont été corrigés et ne sont pas masqués.

## Limites et suite

À la baseline `main@825c7e6dc8556ab9bd30a85c8027d06276b676fb`, le registre `FxRate` est persistant et ingesté avec reçus idempotents. `PricingPolicyVersion` et `TaxPolicyVersion` n’y sont pas encore persistés; leur livraison est proposée dans la PR #178, actuellement en brouillon. `PricingQuote`, `PricingQuoteLine`, `PricingQuoteRevocation` et la sélection d’un taux dans une cotation commerciale restent à réaliser. Aucun fournisseur FX n’est configuré, aucune conformité fiscale n’est déclarée, les calculs historiques Sales/Billing ne sont pas remplacés et aucune transaction POS n’est livrée.

## C3.3.3 — Registre des policies de prix et configurations fiscales (en cours)

- PR [#178](https://github.com/jupi-z/Monarque-Connect/pull/178), état `draft`, head initial `78edeb1741d509882e9fb2cb02a332cdeed65b31`, base `main@825c7e6dc8556ab9bd30a85c8027d06276b676fb`.
- Périmètre proposé: policies versionnées immuables par tenant/produit; configuration fiscale en `DRAFT`, activation explicite OWNER/ADMIN; contrôle des droits produit, idempotence, concurrence, audit et Outbox atomiques; triggers PostgreSQL d’immuabilité; aucun calcul fiscal ni conformité légale.
- Contrat runtime et E2E HTTP/PostgreSQL ajoutés sur la branche. Le premier run [40672829952](https://github.com/jupi-z/Monarque-Connect/actions/runs/40672829952) a échoué au lint parce que les delegates Prisma des modèles non encore présents dans le schéma étaient référencés par les tests. C’est un échec de compilation du test de caractérisation; aucune assertion HTTP n’a été exécutée.
- Le SHA `f0b19760ce9fc69da9496b6c5f7d0545251b7682` a échoué au lint sur une assertion TypeScript redondante: [run 40675105769](https://github.com/jupi-z/Monarque-Connect/actions/runs/40675105769). Après suppression du cast, le SHA `869d39e1b9eee70b0371dc9682ad53ceb4badfe4` a passé le lint et échoué au typecheck, car le type `TaxCalculationCurrency` restait requis par le sérialiseur: [run 40675529080](https://github.com/jupi-z/Monarque-Connect/actions/runs/40675529080). L’import type a été rétabli sans réintroduire le cast.
- Le SHA `869d39e1b9eee70b0371dc9682ad53ceb4badfe4` a passé lint, typecheck, Prisma validate et les preuves de migration antérieures jusqu’à la preuve Phase 10A. Celle-ci signalait à tort l’absence des noms d’index uniques `pricing_policy_versions_scope_code_version_key` et `tax_policy_versions_scope_code_version_key`, car le vérificateur ne lisait que `pg_constraint` alors que PostgreSQL les expose comme index dans `pg_indexes`: [run 40675830513](https://github.com/jupi-z/Monarque-Connect/actions/runs/40675830513). Le vérificateur a été corrigé pour inspecter les contraintes et les index; aucun contrôle de migration ni aucune migration historique n’a été supprimé ou modifié.
- Validations de migration, OpenAPI, contrat, tests et build pour ce lot : `PENDING` jusqu’aux résultats GitHub Actions sur le SHA complet.

La conception n’inclut pas de statut `REVOKED` sans commande de révocation réellement définie; une correction de politique se fait par une nouvelle version et les historiques demeurent immuables.

## Limites et suite

Les quotes, les lignes de quote, les snapshots de calcul et la consommation commerciale de taux FX restent à réaliser dans C3.3/C3.4. La configuration d’un fournisseur FX réel, la conformité fiscale et le POS ne sont pas inclus dans ces livraisons.
