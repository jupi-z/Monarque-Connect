# C3 — Shared Catalog, Pricing, Measures & FX: contrat normatif

**Statut : contrat C3.1 gelé; C3.2, C3.3.1–C3.3.4 sont livrés sur main.** C3.3.4 (PR [#180](https://github.com/jupi-z/Monarque-Connect/pull/180)) a fusionné au commit `173d68ff9bc8bb0beab16e4e0e72d788b91435b8`; CI PR [40704490523](https://github.com/jupi-z/Monarque-Connect/actions/runs/40704490523) et post-fusion [40705791462](https://github.com/jupi-z/Monarque-Connect/actions/runs/40705791462) réussies. Le noyau Decimal de calcul d’une ligne est livré, mais il ne persiste pas de devis ni de snapshot. L’OpenAPI runtime comprend les registres FX, offres/prix, variantes et policies versionnées; les endpoints de cotation restent planifiés. Les preuves sont suivies dans [Docs/123](123_C3_EXECUTION_STATUS.md), [Docs/124](124_C3_2_CATALOG_MEASURES_EXECUTION_EVIDENCE.md) et [Docs/125](125_C3_3_PRICE_VERSION_EXECUTION_STATUS.md).

## 1. Base de code auditée et propriétaires

Audit effectué sur `main@2dff07eae662d8de186d6f23cf831dd72c1dfec9` après CI post-fusion #40635438412 verte.

| Donnée/capacité | Propriétaire actuel | Preuve et conséquence C3 |
|---|---|---|
| Produit/entitlements du Core | `ProductCatalog`, plans et résolveurs produits | `prisma/schema.prisma:820,917`; `PriceVersion` à cette ligne est le prix d'abonnement SaaS. Il demeure réservé à FairScale et ne sera pas réutilisé pour vendre les articles d'un tenant. |
| Article tenant | `Item` et `ItemService` | `prisma/schema.prisma:1918`, `src/referentials/item.service.ts:46`; `Item` est rattaché à une organisation, possède `unit`, `referencePrice Decimal(19,4)`, devise et suivi de stock. `referencePrice` est une donnée legacy mutable, pas un tarif versionné ni une preuve de prix accepté. |
| Offre commerciale et tarifs tenant | Aucun modèle canonique versionné actuellement | À créer en C3, sans dupliquer `Item`. L'offre référence l'Item canonique; un tarif publié est immuable et possède une période de validité explicite. |
| Devis/commande/facture commerciales | Sales | `Quote`, `QuoteLine`, `SalesOrder`, `SalesOrderLine`, `Invoice`, `InvoiceLine` dans `prisma/schema.prisma:2144–2289`. Les lignes conservent des snapshots et les relations Item sont tenant-scoped. |
| Calcul de lignes Sales historiques | Sales | `src/sales/money.ts:6,25`; Prisma Decimal, arrondi HALF_UP, 4 décimales monétaires et calcul de ligne. `src/sales/quote.service.ts:87` et `src/sales/order.service.ts:134` consomment encore les DTO historiques. |
| Stock et mouvements | Inventory | Inventory conserve le ledger et les soldes; C3 ne déplace ni ne convertit rétroactivement des mouvements. C4 devra convertir les quantités vendues vers l'unité de stock dans sa commande transactionnelle. |
| Fournisseurs, RFQ et achats | Purchases | Les lignes gardent des snapshots d'unité/quantité/prix. Aucune interprétation rétroactive ou modification de documents achevés. |
| Abonnement et facture SaaS | Billing | Tables `PriceVersion`, `BillingQuote`, `BillingInvoice`; isolées de toute offre commerciale de tenant. |
| Devise d'organisation | Organization | `defaultCurrency` reste inchangée. Aucune migration C3 ne la remplace ni ne convertit les documents historiques. |

Les tests existants examinés comme preuves des contrats historiques sont `tests/referentials/items.integration.test.ts`, `tests/sales/money.test.ts`, `tests/sales/quotes.integration.test.ts`, `tests/sales/orders.integration.test.ts`, `tests/sales/invoices.integration.test.ts`, `tests/fairscale/fairscale.pricing.test.ts`, `tests/purchases/purchase-orders.integration.test.ts` et `tests/inventory/inventory-ledger.integration.test.ts`. Ce sont les suites de référence pour le non-impact C3; elles seront exécutées sur le runner GitHub dans les PR d'implémentation. Leur présence ne signifie pas que les nouveaux comportements C3 sont déjà testés ou livrés.

Le schéma actuel n'a pas de référentiel d'unités, variantes, offres commerciales, prix tenant versionnés, politiques de calcul ou taux FX. Les unités sont des chaînes libres dans Item et les snapshots métier. Les DTO historiques de devis/commandes acceptent un `unitPrice`, une remise et un taux fiscal soumis aux permissions Sales existantes. C3 ajoute une voie de calcul tarifaire serveur et n'altère pas silencieusement ces contrats historiques. Les nouvelles intégrations doivent référencer un résultat de pricing côté serveur; le raccordement obligatoire des parcours de transaction à ce résultat est un gate explicite de C4.

Le champ `productCode` est un sélecteur non fiable. Le contrat transporte un code opaque conforme au format stable du registre; le service valide son existence, son attribution au tenant et les droits du principal à chaque requête. Les codes initiaux sont `MONARQUE_CONNECT` et `ZAMUREK`, mais OpenAPI ne fige pas une énumération fermée qui empêcherait l'ajout futur d'un produit enregistré.

## 2. Modèle canonique cible

### 2.1 Item, variante et offre

- `Item` demeure la référence tenant canonique pour un produit ou service. C3 n'en change ni l'ID ni les relations existantes.
- `Item.unit`, `Item.referencePrice` et `Item.currency` restent lisibles et compatibles pour les clients legacy. `referencePrice` est indicatif; le moteur ne l'utilise jamais comme prix commercial autoritaire.
- `ItemVariant` décrit une déclinaison d'un Item, tenant-scoped, avec code stable et attributs descriptifs bornés. SKU unique dans l'organisation lorsque présent. Une variante ne crée ni nouvel Item d'inventaire ni ledger distinct.
- `CommercialOffer` est la proposition vendable d'un Item ou de sa variante. Elle est scoped par `organizationId` et `productCode` validé par le serveur; `establishmentId` et canal sont facultatifs et servent à restreindre le contexte. Le client ne peut obtenir un droit en envoyant `productCode`.
- Les clés étrangères des objets tenant incluent l'organisation. Une offre ne peut référencer qu'un Item et une variante de la même organisation. L'établissement est vérifié par `AuthorizationService` et le contexte d'autorisation C1/C2.
- Les offres et tarifs SaaS FairScale ne sont jamais représentés par `CommercialOffer` et les abonnements ne confèrent pas les permissions de catalogue/vente d'un autre produit.

Modèles persistants retenus pour C3 (noms à reprendre dans Prisma): `MeasureUnit`, `CurrencyDefinition`, `ItemVariant`, `CommercialOffer`, `CommercialPriceVersion`, `PricingPolicyVersion`, `TaxPolicyVersion`, `FxRate`, `PricingQuote`, `PricingQuoteLine` et `PricingQuoteRevocation`. Ils étendent le Core, ne créent pas de service autonome et restent sous les modules Nest référentials/pricing. `CommercialOffer` appartient au tenant/produit, `ItemVariant` à un Item, `MeasureUnit` et `CurrencyDefinition` sont des références contrôlées par le Core, `FxRate` est plateforme/source-scoped, et `PricingQuote` est tenant/acteur/produit-scoped.

Les références de devise auront une source officielle versionnée et une allowlist technique (`CurrencyDefinition`: code ISO 4217, fraction digits, révision/provenance, état). Le catalogue des codes autorisés peut évoluer sans réécrire le code devise historique stocké dans les organisations ou documents.

### 2.2 Mesures

- Le registre initial de `MeasureUnit` est serveur, stable et en lecture seule par API; ajout ou correction requiert migration/version et ne réécrit pas les snapshots déjà émis.
- Chaque unité a un `code`, une dimension (`MASS`, `VOLUME`, `LENGTH`, `COUNT`, `TIME` ou dimension versionnée), une unité de base et un facteur positif exact `base units per unit = numerator / denominator` représenté par entiers. Quantité normalisée = quantité source × numerator / denominator. Les deux entiers sont strictement positifs et bornés (max 18 chiffres chacun) pour éviter dépassement.
- Conversion autorisée uniquement dans une dimension identique. Pas de conversion masse-volume implicite (densité), ni conversion dépendante d'un article dans le registre générique.
- Une offre exprime son tarif par unité de vente reconnue. Quantité d'entrée: chaîne décimale avec au plus 12 chiffres entiers et 12 décimales (`NUMERIC(24,12)`), strictement positive. Zéro, négatif, notation exponentielle, NaN, Infinity et overflow sont refusés.
- Le calcul conserve la quantité fournie, l'unité source, la quantité normalisée, l'unité de base et la règle/facteur de conversion dans le snapshot. Les historiques d'Inventory/Purchases/Sales ne sont pas convertis en place.

### 2.3 Prix et politiques

- `CommercialPriceVersion` (nom distinct du `PriceVersion` FairScale) est append-only après publication. Il porte l'offre, devise, montant unitaire en chaîne décimale avec au plus 16 chiffres entiers et 8 décimales (`NUMERIC(24,8)`), unité de prix, `effectiveFrom`, provenance et acteur. Les clients ne choisissent pas de date passée; par défaut l'instant est fixé côté serveur et une prise d'effet future est autorisée.
- Pour un même couple offre/devise, la période d'une version publiée est `[effectiveFrom, nextEffectiveFrom)`; la dernière reste ouverte. `effectiveUntil` est calculée par le serveur à partir de la prochaine version et n'est pas éditable. Les versions sont ajoutées dans l'ordre strictement croissant sous verrouillage de la ligne `CommercialOffer`, et une unicité SQL `[offerId, currency, effectiveFrom]` empêche les doublons concurrentiels. Les offres peuvent être désactivées par une transition auditée, indépendante des versions historiques.
- Une correction financière publiée crée une nouvelle version. Une version publiée n'est ni éditée ni réactivée; l'ancienne période se termine par la borne de la nouvelle version sans mutation de l'ancienne ligne. Les valeurs des cotations déjà émises restent identiques.
- `PricingPolicyVersion` fixe côté serveur les règles de sélection, les unités autorisées, le mode d'arrondi, l'échelle de calcul, les remises autorisées, la fraîcheur FX et les règles fiscales configurées. Elle est immuable après activation.
- Le demandeur peut choisir une offre et une quantité, mais ne fournit jamais le prix final, le montant de remise autorisé, le taux FX ni un taux fiscal faisant autorité. Les permissions de publication de tarifs et politiques sont distinctes de la permission de lire/calculer un prix.
- Une remise est appliquée seulement si une règle publiée l'autorise et si son acteur, produit, établissement, canal, date et seuils sont validés côté serveur. Sinon elle est refusée; une politique inconnue ne réduit jamais le montant.
- Une policy fiscale est d'abord créée en `DRAFT`, puis activée par une commande distincte, idempotente et auditée du propriétaire/administrateur tenant. L'activation signifie uniquement que le tenant a revu ses paramètres techniques; elle ne constitue pas une validation juridique ni une homologation. Si le contexte exige une règle fiscale et qu'aucune policy active ne correspond, le devis échoue fermé.

### 2.3.1 API, acteurs, permissions et erreurs (contrat cible)

Ces routes sont **PLANNED** jusqu'à leur livraison et leur présence dans l'OpenAPI générée. Elles sont sous `/api/v1` et conservent les conventions HTTP/Problem Details du Core.

| Méthode et route cible | Principal/permission | Contrat |
|---|---|---|
| `GET /api/v1/catalog/measure-units` | Session interne; lecture des références | Liste versionnée code/dimension/base/facteur; aucune mutation tenant. |
| `GET /api/v1/catalog/currencies` | Session interne; lecture des références | Liste allowlistée code/précision mineure/version de source. |
| `GET /api/v1/organizations/{organizationId}/catalog/offers?productCode=...` | STAFF membership actif, `CATALOG`, `catalog:read`, entitlements du produit demandé | Résultats filtrés tenant, produit et scope établissement; pas de produit par défaut sur le nouvel endpoint. |
| `POST /api/v1/organizations/{organizationId}/catalog/items/{itemId}/variants` | STAFF, `CATALOG`, `catalog:write`, entitlement produit | Crée une variante rattachée à l'Item tenant; code stable unique et attributs bornés/canonisés. |
| `POST /api/v1/organizations/{organizationId}/catalog/offers` | STAFF, `CATALOG`, `catalog:write`, entitlements du produit | Crée une offre à partir d'un Item/variant du même tenant; produit et établissement revalidés serveur. |
| `PATCH /api/v1/organizations/{organizationId}/catalog/offers/{offerId}` | STAFF, `CATALOG`, `catalog:write`, entitlements du produit | Métadonnées seulement; mise à jour avec `expectedVersion`, conflit `409`; ne change jamais un tarif publié. |
| `POST /api/v1/organizations/{organizationId}/catalog/offers/{offerId}/price-versions` | STAFF, `pricing:price:publish`, entitlements produit et scope d'établissement si lié | Crée et publie une version immuable; montant/devise/unité et effet futur; pas de rétrodatation ni modification client de `asOf`. `Idempotency-Key` obligatoire. |
| `POST /api/v1/organizations/{organizationId}/pricing/policy-versions` | OWNER/ADMIN STAFF, `pricing:policy:manage`, entitlements produit | Crée une policy immutable avec effet serveur/futur, paramètres de réduction, arrondi, fraîcheur FX et taxes explicitement configurées; jamais de modification d'une policy active. |
| `POST /api/v1/organizations/{organizationId}/pricing/tax-policy-versions` | OWNER/ADMIN STAFF, `pricing:tax:manage`, entitlements produit | Crée une configuration fiscale technique en brouillon, tenant-scoped et référencée; aucune conformité légale n'est affirmée. |
| `POST /api/v1/organizations/{organizationId}/pricing/tax-policy-versions/{taxPolicyVersionId}/activate` | OWNER/ADMIN STAFF, `pricing:tax:manage`, entitlements produit | Activation explicite, idempotente et auditée; l'accusé de revue du tenant ne vaut pas validation légale. |
| `POST /api/v1/organizations/{organizationId}/pricing/quotes` | STAFF, `pricing:quote:create`, entitlements produit | Entrées: offerId, quantité string, unité demandée, devise cible optionnelle, establishment/channel éventuels, clé idempotence. L'instant et les versions sont fixés par le serveur. Aucun prix, taxe, remise, taux FX ou montant total fourni par le client. |
| `GET /api/v1/organizations/{organizationId}/pricing/quotes/{quoteId}` | STAFF, `pricing:quote:read`, produit et établissement autorisés | Renvoie le snapshot inchangé, sa validité et le marqueur `expired` calculé au moment de lecture. Une ressource hors tenant/scope n'est pas révélée. |
| `POST /api/v1/platform/pricing/fx-rates` | Session authentifiée validée par `PlatformAuthorizationService.assertPlatformAdmin`; capacité plateforme `pricing:fx:ingest` et allowlist serveur de sources | Ingestion idempotente de taux provenant d'une source configurée, avec base/quote/rate/observedAt/validFrom/validUntil/sourceReference. Le registre de devises actif valide la paire; les lignes acceptées et les reçus d'idempotence sont append-only; audit/Outbox sont atomiques et minimisés. Aucun accès tenant implicite, fournisseur live ou source réelle présumée. |

Les permissions tenant distinctes sont `pricing:quote:create`, `pricing:quote:read`, `pricing:price:publish`, `pricing:policy:manage` et `pricing:tax:manage`. CATALOG read/write ne donne pas le droit de publier un prix. Initialement OWNER/ADMIN peuvent publier tarifs et gérer les policies; STAFF SALES/OPERATIONS peuvent demander et lire une cotation selon leurs permissions Sales; FINANCE peut lire les cotations. Les autres rôles reçoivent uniquement les permissions explicitement présentes dans la matrice C3. La capacité d'ingérer FX est PLATFORM seulement et reste séparée des permissions tenant.

Le contrat complet est versionné dans [`contracts/phase10a5-c3-proposed.openapi.yaml`](../contracts/phase10a5-c3-proposed.openapi.yaml) et vérifié par [`tests/contracts/phase10a5-c3-pricing.contract.test.ts`](../tests/contracts/phase10a5-c3-pricing.contract.test.ts). Son état `partially-implemented` distingue les routes effectivement présentes dans `openapi/openapi.yaml` des routes encore planifiées. PR #178 a livré les opérations de création des policies et d'activation d'une configuration fiscale; la validation CI PR et post-fusion est verte. Aucun moteur de quote ou de calcul fiscal n'est inclus dans ce slice.

Schemas OpenAPI normatifs (les champs décimaux sont `string`, regex décimale non exponentielle; les dates sont RFC 3339 UTC):

- `CreateCommercialOffer`: `productCode` requis; `itemId` requis; `variantId?`; `establishmentId?`; `channelCode?`; `sellUnitCode`; `displayName?`. Il n'accepte ni prix, ni devise, ni tenantId (tenant de la route), ni acteur.
- `CreateCommercialPriceVersion`: `amount` (`NUMERIC(24,8)` textual), `currencyCode`, `priceUnitCode`, `effectiveFrom?` future seulement. Le serveur fixe `effectiveFrom` quand absent. `expectedLatestVersionId` est optionnel pour contrôle optimiste; aucun `effectiveUntil` ni statut client.
- `CreatePricingPolicyVersion`: code stable, `effectiveFrom?`, `roundingMode=HALF_UP` pour V1, devises et sources FX allowlistées, `maxFxAgeSeconds`, clés de règles de remise et taxe configurées. Les limites sont validées côté serveur; policy effective future seulement.
- `CreatePricingQuote`: `productCode`, `offerId`, `variantId?`, `quantity` (12 entiers/12 fractionnaires max), `unitCode`, `targetCurrency?`, `establishmentId?`, `channelCode?`. Pas de date de valorisation. `Idempotency-Key` HTTP obligatoire.
- `PricingQuoteSnapshot` (réponse): identité/version/validité, tenant et scopes établissement/canal explicitement présents (nullable si absents), produit, offre/variante (nullable si absente), références et versions, `inputHash`, quantité originale et normalisée, ratio exact utilisé (1/1 pour une conversion identité) et version du registre, prix unitaire source, `subtotal`, `discountAmount`, `netAmount` (tous dans `sourceCurrency`), lignes fiscales avec devise et politique, `sourceTotal` (null uniquement lorsque la taxe est calculée en devise cible), `targetTotal` (montant final payable en `targetCurrency`), arrondi/calcul versionnés et `fx` nullable mais présent (provenance complète si conversion appliquée). Tous les montants/taux/quantités sont des chaînes décimales. Le tenant conserve l'acteur/provenance dans le snapshot persistant et l'audit; l'API n'expose pas les identifiants d'acteur sans besoin d'accès. Le client n'envoie jamais ces montants de sortie comme autorité.
- `IngestFxRate`: `baseCurrency`, `quoteCurrency`, `rate`, `sourceCode`, `observedAt`, `validFrom`, `validUntil`, `sourceReference`. L'allowlist source est une configuration serveur/platform; taux positif et fenêtre valide; `Idempotency-Key` obligatoire; même sourceReference avec contenu divergent = `409`.

Chaque `POST` de mutation a un hash canonique des données économiques. Rejeu identique restitue le résultat; clé identique avec différences d'entrée répond `409`. Réponses décimales sont des chaînes; aucune valeur monétaire API n'est sérialisée en nombre JSON. Codes: `400` format/unité invalide, `401` session absente/invalide, `403` permission/entitlement/scope refusé, `404` ressource absente ou étrangère, `409` idempotence/version/concurrence incompatible, `422` aucune politique/prix/FX admissible. Pas de `asOf` client pour une nouvelle cotation.

Événements transactionnels versionnés et minimisés: `catalog.variant.created`, `catalog.offer.created|updated|status_changed`, `catalog.price_version.published`, `pricing.policy_version.published`, `pricing.fx_rate.ingested|revoked`, `pricing.quote.created`. Audit et Outbox partagent la transaction des mutations. Les payloads contiennent IDs, organisation, produit, établissement si applicable, acteur/provenance, version et hash; aucun contenu personnel ou lignes/montants de cotation dans l'Outbox. La révocation est une ligne d'événement append-only distincte et invalide une cotation pour consommation future sans éditer son snapshot.

### 2.4 Devis tarifaire et snapshot

- La commande `CreatePricingQuote` calcule une cotation sans créer une Quote Sales, SalesOrder, Invoice, PaymentRecord ni écriture Inventory/Cash.
- Le contexte serveur lie organisation, principal, produit, établissement autorisé, canal allowlisté, offre/variante, unité, quantité, devise cible et instant de valorisation. `productCode` ou `establishmentId` envoyés sont des sélecteurs non fiables et doivent être autorisés contre l'acteur.
- La réponse contient l'identité de cotation, expiration, versions de schéma/calcul, tenant et scopes établissement/canal, quantité d'origine et normalisée, prix et devise source, sous-total brut, remises autorisées, net source avant taxe, bases et taxes configurées avec leur devise, totaux source/cible selon la politique, arrondi appliqué, politiques et versions, ainsi que la provenance FX complète si utilisée.
- La cotation persistée est append-only; les lignes snapshotent valeurs acceptées, sources, facteurs et empreinte canonique des entrées. Un trigger/contrôle PostgreSQL empêche modification/suppression des données de calcul. Les références vers l'offre et les versions sont informatives et ne remplacent pas les valeurs snapshotées.
- La clé d'idempotence est scopée au tenant et à l'opération. Rejeu identique renvoie le même résultat sans recalcul ni consommation d'une nouvelle remise; même clé avec payload économique différent répond `409`.
- La validité ne dépasse pas les échéances du prix, de la politique, de la taxe et du FX. C4 doit confirmer une cotation non expirée, non révoquée et conforme aux règles de confirmation avant de créer l'écriture commerciale. Un changement de catalogue ne modifie pas la cotation émise.

## 3. Calcul, échelles et arrondis

- Entrées décimales en chaîne; calcul avec un contexte `Prisma.Decimal` isolé (précision minimale 80 chiffres significatifs), jamais `number` JS pour quantité, prix, taux, remise, taxe ou total. Les prix/taux FX/quantités sont strictement positifs; remises, bases taxables et montants d'impôt sont non négatifs. Une réduction ne peut excéder le sous-total. Ne pas modifier la précision globale utilisée par Sales/FairScale.
- Mesures stockées par facteurs rationnels exacts; conversion calculée sans flottant. Les montants/rates restent en précision décimale suffisante jusqu'au stade d'arrondi explicitement requis.
- Le moteur distingue précision d'entrée, précision intermédiaire, échelle persistée du détail et précision monétaire finale. Prix unitaires: 16 chiffres entiers et 8 décimales (`NUMERIC(24,8)`); quantités: 12 entiers et 12 décimales (`NUMERIC(24,12)`); facteurs FX et taux de configuration fiscale: 6 chiffres entiers et 18 décimales (`NUMERIC(24,18)`); montant source/intermédiaire `NUMERIC(65,28)` et montant converti snapshoté `NUMERIC(65,18)`. Le registre unité stocke des facteurs rationnels positifs; numérateur et dénominateur sont limités à 18 chiffres chacun. Toute conversion hors plage échoue avant écriture; aucune troncature implicite.
- Politique initiale d'arrondi : `HALF_UP`, versionnée. Pour chaque ligne, calculer en précision intermédiaire `quantité normalisée × prix unitaire`, arrondir le sous-total source à la précision mineure source, appliquer dans l'ordre explicite des règles de remise autorisées (somme non supérieure au sous-total), puis arrondir le net source; ces trois montants et les remises sont snapshotés. La taxe est non composée en V1; chaque policy fiscale active précise sa base, son taux non négatif, sa devise de calcul et sa version. En mode `SOURCE`, calculer et arrondir les taxes en devise source, `sourceTotal = net source + somme des taxes source`; convertir ensuite ce total si une devise cible différente est demandée. En mode `TARGET`, convertir le net source vers la cible, l'arrondir à l'unité mineure cible, calculer et arrondir les taxes en cible, puis `targetTotal = net cible + somme des taxes cible`; `sourceTotal` est null parce qu'aucun total après taxe n'existe en devise source. Sans taxe applicable, `sourceTotal = net source`, puis la conversion s'applique si nécessaire. `targetTotal` est toujours le total final dans `targetCurrency`; lorsque source et cible sont identiques, aucun FX n'est appliqué. Somme des lignes déjà arrondies; C3 quote un seul article/offre par résultat, et toute agrégation multi-lignes future devra garder la même règle par ligne. L'affichage ne recalcule jamais le snapshot.
- La précision mineure (`minorUnitDigits`) provient d'un registre de devises autorisées, versionné avec sa provenance ISO 4217 ([maintenance agency SIX](https://www.six-group.com/en/products-services/financial-information/market-reference-data/data-standards.html)). Seuls les codes explicitement allowlistés sont acceptés; code absent = refus, sans fallback sur `Organization.defaultCurrency`. Les arrondis d'espèces sont une policy distincte. Ce registre technique n'est ni une règle fiscale ni une certification.
- Cas de référence synthétique : `125 g = 0.125 kg`; `0.125 × 20 USD/kg = 2.50 USD`; `2.50 × 2360 CDF/USD = 5900 CDF`. Résultat exact `5900 CDF`, taux exclusivement fixture de test.

## 4. FX

- Port fournisseur-neutral `FxRateSource`; aucun fournisseur réel requis ni configuré par C3.
- Un taux stocké spécifie toujours `baseCurrency`, `quoteCurrency`, `rate` (« une unité de base = rate unités de cotation »), source, horodatage d'observation, fenêtre de validité, provenance/version et statut. Le taux est une chaîne décimale avec au plus 6 chiffres entiers et 18 décimales (`NUMERIC(24,18)`), strictement positif et immuable après acceptation.
- Sélection serveur déterministe : taux valide à l'instant de valorisation, source approuvée par policy, âge inférieur ou égal au maximum de fraîcheur, devise/paire explicitement supportée. Taux manquant, invalide, stale, révoqué ou direction incompatible: échec fermé avec erreur métier, sans fallback vers `defaultCurrency`, taux courant arbitraire ou valeur client. Montant FX converti final limité à `NUMERIC(65,18)`; overflow refusé.
- L'inversion demandée calcule `1 / rate` à 18 décimales dans un contexte Decimal dédié; le snapshot garde la paire/source originale, la direction `DIRECT|RECIPROCAL`, la division et sa précision. Si le réciproque sort de `NUMERIC(24,18)` ou de la policy, cette paire/direction est refusée et doit disposer d'un taux direct approuvé; ne jamais présenter le réciproque tronqué comme exact ni créer un faux taux fournisseur.
- Spread, commission, frais et impôt restent des postes/policies séparés et n'altèrent pas silencieusement le taux de référence.

## 5. Taxe, accès et audit

- C3 offre une abstraction `TaxPolicyVersion` tenant/juridiction/type/date lorsque nécessaire; le taux n'est pas une vérité juridique par défaut. Les seules règles actives proviennent d'une configuration explicite et autorisée. Les fixtures synthétiques sont marquées test.
- Si la transaction demande un calcul fiscal obligatoire et qu'aucune règle applicable et validée n'existe, la cotation est refusée. `NOT_APPLICABLE` ou `EXEMPT` ne sont pas déduits par défaut d'un taux manquant.
- Les endpoints de gestion réutilisent AuthGuard, AuthorizationService, permissions CATALOG/pricing centralisées, scopes d'établissement et vérification produit C1. Le contexte ne vient pas d'un `actorType` ou claim client.
- Création/publication/retrait de variante, offre, tarif ou politique requiert audit et Outbox atomiques avec la mutation. Les consultations et refus peuvent être audités selon la politique de sécurité sans journaliser de PII inutile.
- Toute lecture ou mutation vérifie tenant puis établissement; l'absence ou la non-appartenance retourne une réponse qui ne divulgue pas une ressource étrangère.

## 6. Compatibilité, SQL et évolutions

- Pas de modification des migrations fusionnées, des IDs `Item`, de `Organization.defaultCurrency`, des colonnes/totaux Sales, des prix FairScale, des lignes Purchase, ni des ledgers Inventory.
- Pas de backfill qui interprète `Item.referencePrice` comme un prix vendu accepté. Une migration additive peut rattacher une unité legacy uniquement si le code est reconnu sans ambiguïté; les chaînes inconnues restent lisibles et non convertibles par le moteur jusqu'à une résolution explicite.
- Intégrité SQL cible: FK composites tenant-scoped (`organizationId`), FK de produit vers le registre produit, checks de signes/échelles et validité des dates; exclusion durable des périodes de prix publiées concurrentes; unicité d'idempotence; immutabilité DB des snapshots publiés. Les contraintes exactes sont arrêtées dans chaque plan de migration avant le DDL.
- C3 fournit la cotation et le snapshot. Le raccordement des ventes/purchases existantes, l'orchestration du POS et la consommation physique du stock restent une évolution compatible C4; aucune transaction historique ne sera réévaluée.
- API `/api/v1/organizations/{organizationId}/catalog/...` et `/pricing/quotes` comme cible de contrat seulement; OpenAPI définit formats, erreurs 400/403/404/409/422, idempotence, pagination, précision string et politiques d'expiration avant le premier endpoint.

## 7. Matrice minimale de preuves

| Axe | Cas positifs | Refus et concurrence |
|---|---|---|
| Tenant/produit/établissement | offre de l'organisation et du produit attribué | tenant étranger, établissement hors scope, faux productCode, produit suspendu |
| Mesures | g↔kg, ml↔l, quantité fractionnaire et exacte | dimensions incompatibles, zero/négatif, échelle dépassée, ratio invalide, overflow |
| Prix | sélection temporelle versionnée, déterministe, devise permise | date passée choisie par client, prix expiré, période chevauchante, version modifiée, prix client injecté |
| FX | direct et réciproque, source et fraîcheur snapshotées | taux absent, nul, négatif, stale, paire non autorisée, données d'un fournisseur inconnu |
| Calcul | 125g/20USD/kg/2360 CDF = 5900 CDF; multi-lignes avec arrondis déterministes | cas frontières, remise non permise, taxe inconnue si requise, montant final falsifié |
| Snapshot/idempotence | rejouer même commande retourne le snapshot identique | payload divergent `409`, tentative SQL update/delete bloquée, changement ultérieur du prix/taux sans altérer snapshot |
| Compatibilité | Items historiques, defaultCurrency et transactions existantes identiques | FairScale non affecté, Sales/Purchases/Inventory snapshots non réécrits |

Les invariants SQL, migrations depuis base vide et historiques supportés, tests PostgreSQL concurrentiels, E2E HTTP, OpenAPI, contrat ZAMUREK allowlisté et CI PR/post-fusion sont requis avant clôture. Un fournisseur FX réel, une validation juridique/fiscale, le POS et un stockage de documents ne sont pas des preuves C3 ni ne peuvent être annoncés comme livrés.

## 8. Séquence et retour arrière

1. C3.1: gel du présent contrat et des DTO/réponses/erreurs OpenAPI; aucune migration métier.
2. C3.2: registre mesure, variantes/offres, index et relations additives; migration non destructive et fixtures/backfill uniquement non ambigu.
3. C3.3: prix/policies/taxes/FX et quotes snapshots, contrôles Decimal et invariants immutables.
4. C3.4: tests hostile de concurrence/tenancy, migrations historiques, diff OpenAPI, preuve de non-régression, clôture factuelle.

Pour rollback applicatif, endpoints C3 peuvent être désactivés sans supprimer les nouveaux objets. Après écriture de données, préférer forward-fix; aucune suppression de colonnes ou recalcul d'historique. Un contract/drop éventuel exige une phase future, une preuve d'absence d'écrivains/lecteurs et une nouvelle autorisation.

## 9. Décisions et risques résiduels

- **DECIDED:** `Item` reste canonique; offre/prix commercial distinct de Billing SaaS; unités par facteurs rationnels et dimension; requêtes serveur autoritaires; snapshots immuables; arrondi `HALF_UP` des lignes puis somme; FX fail-closed et indépendant du fournisseur; tax policy technique sans prétention de conformité.
- **À vérifier avant migration C3.2:** exécution CI PostgreSQL 17 des contraintes SQL détaillées, set initial allowlisté d'unités/devises et sérialisation exacte des schemas OpenAPI. Le modèle temporel append-only est protégé par verrou de ligne et unicité SQL, sans dépendance `btree_gist`. Les bornes numériques sont fixées ci-dessus et seront éprouvées contre Inventory/Sales sans modifier leur schéma.
- **Risques acceptés jusqu'à C4:** routes Sales historiques acceptent les montants entrés par un STAFF autorisé et n'utilisent pas encore un `pricingQuoteId`; C4 devra offrir le chemin serveur-référencé tout en gardant la compatibilité legacy explicitement gouvernée.
- **NOT IMPLEMENTED:** fournisseur FX externe, tarif commercial ZAMUREK, règles fiscales réelles, transactions POS, conversion des ledgers historiques, parcours de taxe certifié.

Ces points ouverts restent des critères d'acceptation des PR C3.2/C3.3. Ils ne sont pas des preuves d'implémentation et doivent être résolus avant d'annoncer le comportement concerné comme livré.
