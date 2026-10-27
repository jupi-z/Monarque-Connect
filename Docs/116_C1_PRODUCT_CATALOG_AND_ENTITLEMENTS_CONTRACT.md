# C1 — Product Catalog & Product-Scoped Entitlements

**Statut : contrat normatif accepté en C0 et livré dans C1.1–C1.4.** Ce document reste la référence de contrat du catalogue produit, du scope produit des plans/souscriptions/droits/quotas et de la compatibilité des resolvers. Il n'active aucune offre commerciale ZAMUREK; preuves finales dans [Docs/118](118_C1_CLOSURE_EVIDENCE.md).

## 1. Décisions et vocabulaire

- Le Core est la seule autorité. Le registre `ProductCatalog` est alimenté par le serveur et contient initialement `MONARQUE_CONNECT` et `ZAMUREK`; le client ne peut créer de code ni choisir un produit pour obtenir des privilèges.
- `MONARQUE_CONNECT` est le produit historique par défaut du backfill, sans changer un seul identifiant ou snapshot historique.
- `ZAMUREK` peut avoir un abonnement indépendant de Monarque Connect. Son prix de 7 USD/mois reste une hypothèse commerciale inactive. C1 ne crée ni n'active `PriceVersion` ZAMUREK.
- Un produit est un scope d'accès commercial, pas une frontière de stockage ou un tenant. `organizationId` reste l'identité de tenant; `establishmentId` reste le scope opérationnel secondaire.
- Toute API legacy sans `productCode` continue de cibler uniquement `MONARQUE_CONNECT`. Toute nouvelle résolution multi-produit requiert un code produit explicite; aucun fallback n'est permis.

## 2. Modèles et propriétaires des données

| Donnée | Autorité / écriture | Lecture et scope C1 |
|---|---|---|
| Product catalog et affectation module/produit | Seed/migration contrôlés par le Core; pas d'écriture publique | `ProductCatalog` et `ProductModule` déterminent les seuls modules résolubles dans un produit |
| Plan et PlanVersion | Administration/catalogue Billing Core | PlanVersion appartient à un seul produit; versions publiées restent immuables |
| Subscription | `SubscriptionService` | `organizationId + productCode + at`; dates et états gardent les règles historiques du produit |
| BillingSubscriptionTerm | Billing Core; FairScale actuel rattaché à Monarque Connect | Le produit est cohérent avec la Subscription liée; le C1 n'ajoute aucun checkout ZAMUREK |
| Module activation / entitlement override | Services d'administration existants, étendus avec scope produit | Résolution limitée au produit explicite; Core global et suspension organisation restent prioritaires |
| Quota usage / reservation / ledger | `QuotaService` dans la transaction de l'opération consommatrice | Clés d'unicité, idempotence et période incluent le produit; événements gardent tenant et quota |

Depuis C1.2, les plans, versions, abonnements, activations, overrides et quotas portent un `productCode` explicite, rétro-rempli vers `MONARQUE_CONNECT` sans changer leurs IDs. C1.3 ajoute `ProductModule`, registre contrôlé côté serveur, et des clés étrangères composées empêchant d'associer un module à un produit auquel il n'est pas inscrit. Les appels legacy de `OrganizationService`, `InvitationService`, Billing FairScale et des modules d'autorisation restent explicitement Monarque Connect. Aucun service ne doit sélectionner par `findFirst({ organizationId })` sans filtre produit lorsqu'un choix de produit est requis.

## 3. API et compatibilité

- `SubscriptionService.resolveEffective(organizationId, at?, db?)` garde son contrat et ses résultats Monarque Connect exclusivement. `SubscriptionService.resolveEffectiveForProduct(organizationId, productCode, at?, db?)` exige un code produit et refuse les produits inconnus/inactifs.
- `EffectiveEntitlementsService.resolve(organizationId, at?, db?)` reste le resolver legacy Connect. `EffectiveEntitlementsService.resolveForProduct(organizationId, productCode, at?, db?)` est une entrée distincte, explicitement scoped.
- Les opérations quota existantes restent Connect; les variantes product-scoped exigent le produit et maintiennent la portée établissement de l'appelant.
- Aucun endpoint métier n'est ajouté par défaut dans C1. Si l'API publique est affectée, le changement est additif dans OpenAPI, avec test snapshot/golden legacy et compatibilité au moins N/N-1 selon la politique active.
- Les modules sont des capacités du Core. Une entitlement ZAMUREK n'accorde aucun module Connect par simple appartenance au produit; les capacités partagées sont accordées par permission d'action explicite.

## 4. Schéma et migration additive prévue

Avant migration, inventorier et enregistrer les comptes de lignes, les codes de plans et périodes effectives. Les contraintes historiques ne sont pas éditées.

1. Ajouter `ProductCatalog` et les colonnes `productCode` nécessaires, initialement nullable, ainsi que clés/FK et index non bloquants.
2. Insérer le produit `MONARQUE_CONNECT`; backfill idempotent des plans/versions, subscriptions, activations, overrides, usages, réservations/ledgers et termes Billing historiques vers Connect, en conservant leurs IDs.
3. Vérifier zéro valeur NULL, zéro code inconnu, cohérence `PlanVersion`/`Subscription`/Billing, absence de doublons de périodes par organisation/produit et alignement des clés de quota/idempotence.
4. Ajouter contraintes NOT NULL, clés étrangères et unicités composées après preuve des contrôles.
5. Remplacer les exclusions GiST globales par des exclusions composées `(organization_id, product_code, period range)` pour `subscriptions` et `billing_subscription_terms`, en conservant exactement les statuts couverts. Ce remplacement intervient dans la nouvelle migration seulement, jamais par réécriture d'une migration publiée.
6. Déployer les lecteurs legacy Connect et les lecteurs scoped de manière additive; garder les termes FairScale historiques et la politique de grâce inchangés. Un abonnement simultané Connect/ZAMUREK est permis; deux périodes effectives qui se chevauchent pour un même produit restent interdites sous concurrence PostgreSQL.

Les tables de quota utilisent actuellement des unicités sans produit (`organization_id, quota_code, period_key`, `organization_id, idempotency_key`) et une FK composite vers l'usage. C1 doit ajouter productCode à ces clés et à la FK ensemble, sinon une réservation d'un produit pourrait écraser ou consommer la capacité de l'autre. Unicités de ledgers et d'idempotence sont ajustées de façon compatible en préservant l'historique.

## 5. Suspensions, droits et abonnements

- Suspension globale de l'organisation refuse tous les produits.
- Suspension commerciale d'un produit affecte uniquement ce produit.
- Les statuts et dates effectifs continuent de respecter les règles existantes pour Connect, notamment dunning/grâce; tout nouveau produit doit définir explicitement une politique versionnée et n'hérite d'aucune grâce par défaut.
- Une activation, un override ou une limite de quota est produit-scoped. Un override ne traverse pas les produits ni les modules; l'autorité et l'audit existants sont conservés.
- Le resolver refuse l'accès si aucune subscription effective n'existe pour le produit demandé; aucun abonnement d'un autre produit ne sert de fallback.
- Les renouvellements sont idempotents et ne peuvent créer de chevauchement; l'exclusion PostgreSQL est le garde final contre les courses.

## 6. Tests et critères d'acceptation C1

### Avant migration (C1.1)

- Golden tests des résultats de `resolveEffective(organizationId)` et des payloads/capacités legacy pour les plans CONNECT, FairScale, grâce, activation, override et suspension.
- Tests contractuels d'un code produit obligatoire pour le resolver scoped; produit inconnu, autre produit absent et accès multi-tenant refusés sans fuite.
- Répertorier chaque consommateur legacy et prouver son intention Connect.

### Migration (C1.2)

- Prisma validate/generate, migration PostgreSQL depuis vide et depuis chaque état historique CI pris en charge.
- Fixtures synthétiques de données mixtes, backfill interrompu/rejoué, IDs et snapshots invariants.
- Deux subscriptions Connect/ZAMUREK simultanées autorisées; chevauchement même produit refusé aussi sous transactions concurrentes.
- Vérifier les contraintes d'exclusion sur subscriptions et Billing terms, FK et index quota composés.
- Exécuter seed deux fois et prouver qu'aucun tarif ou version publiée n'est réécrit.

Preuve de livraison C1.2 : PR #159 fusionnée par squash dans `cd5eb2fb0272bbe08abde60809ece945699c9bae`; CI PR #526 et CI post-fusion #527 réussies. Le commit de merge porte les migrations et preuves C1.1/C1.2.

### Services (C1.3–C1.4)

- Organisation Connect seule, ZAMUREK seul et double produit.
- Produit A suspendu, produit B actif; suspension globale refuse les deux.
- Quotas, activations et LIMIT_OVERRIDE isolés par produit; ZAMUREK ne donne pas CRM/Purchases/Finance/Admin Connect.
- Replays identiques ne dupliquent pas; clé identique avec autre produit/payload échoue avec conflit.
- Tests HTTP d'autorisation, établissement, tenant, et non-régression des clients existants; OpenAPI/contrats inchangés ou mise à jour versionnée.
- Tests entitlements, Sales, Cash, Inventory, Billing, Intelligence, migrations et E2E complets dans CI GitHub-hosted; CI PR et post-fusion avant lot suivant.

### Règle de registre C1.3

`ProductModule(productCode, moduleCode)` est l'autorité d'affectation. Le backfill enregistre tous les modules existants pour `MONARQUE_CONNECT`; il enregistre uniquement les modules `isCore` pour `ZAMUREK`. La migration échoue explicitement si des affectations commerciales ZAMUREK préexistantes sont détectées. Les clés étrangères composées sur `PlanVersionModule`, `OrganizationModuleActivation` et `OrganizationEntitlement` rendent toute affectation hors registre impossible en base. L'activation commerciale ZAMUREK reste vide : le prix de 7 USD et toute offre restent inactifs.

`resolveForProduct` ne retourne que les modules inscrits pour le produit demandé. `resolveEffective` et `EffectiveEntitlementsService.resolve` conservent leur portée Connect pour tous les droits; pour préserver la réponse historique, la projection legacy peut lister des modules d'autres produits mais ils restent explicitement refusés (`allowed: false`, `MODULE_NOT_INCLUDED`). Les souscriptions, activations, overrides, plans et quotas consommés par le resolver legacy restent `MONARQUE_CONNECT` scoped. Les opérations produit-scoped utilisent le produit explicite; leurs événements ZAMUREK sont distincts, sans changer les noms ni les payloads historiques Connect.

Preuves C1.3 et C1.4 : PR [#160](https://github.com/jupi-z/Monarque-Connect/pull/160) et [#161](https://github.com/jupi-z/Monarque-Connect/pull/161) fusionnées; CI PR et post-fusion consignées dans [Docs/117](117_C1_EXECUTION_STATUS.md) et [Docs/118](118_C1_CLOSURE_EVIDENCE.md). Les tests vérifient l'isolation des entitlements et quotas et le refus explicite des modules hors portée Connect dans les surfaces legacy.

## 7. Retour arrière et risques

Le déploiement initial garde les nouvelles colonnes/tables, peut désactiver la lecture scoped et continuer via le resolver Connect si les nouvelles écritures restent compatibles; aucun `down` ne supprime les backfills. Tout problème de cohérence se corrige par forward-fix, ou restauration opérée suivant une procédure testée hors machine de développement. La contraction d'anciens index/contraintes attend un déploiement ultérieur stable.

Risques à traiter pendant C1 : volumétrie du backfill; choix de relations composées Prisma; compatibilité du Billing historique; migration des clés quota avec reservations actives; effet de la nouvelle dimension sur tous les tests seedés. Les migrations doivent échouer clairement si des doublons ou états inconsistants précèdent la contrainte; aucune activation commerciale ZAMUREK n'est comprise dans C1.
