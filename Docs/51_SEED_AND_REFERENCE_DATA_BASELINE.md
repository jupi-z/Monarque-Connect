# 51 — Seed and Reference Data Baseline

## Objet

Les seeds initiaux sont des données versionnées et reproductibles. Ils ne sont pas dispersés dans les controllers.

## 1. Business Types v1

Codes :
- `SERVICE_PROVIDER`
- `COMMERCE_DISTRIBUTION`
- `MINING_SUPPLIER_B2B`
- `SMALL_INDUSTRY`
- `OTHER`

Ils sont actifs par défaut.

Les presets sont ceux de `33_BUSINESS_TYPES_PLANS_ENTITLEMENTS.md`.

## 2. Module Catalog v1

Codes core non-gatables :
- AUTH
- ORGANIZATION
- ESTABLISHMENTS
- MEMBERSHIPS
- PLATFORM_SECURITY
- DATA_PORTABILITY

Codes commerciaux :
- CATALOG
- CRM
- SALES
- PURCHASES
- INVENTORY
- EXPENSES
- CASH
- PROJECTS
- DOCUMENTS
- NETWORK_PROFILE
- NETWORK_TRUST
- NETWORK_DISCOVERY
- NETWORK_CONNECTIONS
- NETWORK_INQUIRIES
- MESSAGING
- INTELLIGENCE_BASIC

Tous les modules listés ci-dessus ont `availability=MVP`.

## 3. Dépendances machine-interprétables

- SALES → ALL_OF(CATALOG)
- PURCHASES → ALL_OF(CATALOG)
- INVENTORY → ALL_OF(CATALOG)
- NETWORK_TRUST → ALL_OF(NETWORK_PROFILE)
- NETWORK_CONNECTIONS → ALL_OF(NETWORK_DISCOVERY)
- NETWORK_INQUIRIES → ALL_OF(NETWORK_PROFILE)
- MESSAGING → ALL_OF(NETWORK_CONNECTIONS)
- INTELLIGENCE_BASIC → ANY_OF(CRM, SALES, PURCHASES, INVENTORY, EXPENSES, CASH, PROJECTS)

Les autres modules commerciaux n'ont pas de dépendance obligatoire.

Les dépendances sont stockées sous une représentation structurée versionnée ; jamais comme texte libre tel que « au moins un module actif ».

## 4. Plans v1

Plan codes :
- `CONNECT`
- `OPERATIONS`
- `BUSINESS`
- `ENTERPRISE`

Version initiale : `1`.

### CONNECT v1
Allowed :
- CATALOG
- NETWORK_PROFILE
- NETWORK_TRUST
- NETWORK_DISCOVERY
- NETWORK_CONNECTIONS
- NETWORK_INQUIRIES
- MESSAGING

### OPERATIONS v1
CONNECT +
- CRM
- SALES
- EXPENSES
- DOCUMENTS
- INTELLIGENCE_BASIC

### BUSINESS v1
OPERATIONS +
- PURCHASES
- INVENTORY
- CASH
- PROJECTS

### ENTERPRISE v1
Tous les modules commerciaux MVP.

## 5. Default activation

Le plan autorise ; le business type recommande.

Activation initiale d'un module commercial :

`effective entitlement ALLOW && (business preset defaultActivation || plan defaultEnabled)`

Pour v1, `plan.defaultEnabled=false` pour les modules commerciaux. Les presets métier déterminent donc l'activation initiale.

Un admin tenant peut ensuite activer tout module entitled dont les dépendances sont satisfaites.

## 6. Quotas v1

Quota codes :
- `MAX_USERS`
- `MAX_ESTABLISHMENTS`
- `STORAGE_BYTES`
- `MAX_ACTIVE_PROJECTS`
- `MONTHLY_NETWORK_INQUIRIES`

Afin de ne pas figer prématurément la tarification commerciale :
- CONNECT : `MAX_ESTABLISHMENTS=1`
- OPERATIONS : `MAX_ESTABLISHMENTS=1`
- BUSINESS : pas de limite technique seedée pour les établissements
- ENTERPRISE : pas de limite technique seedée pour les établissements
- les autres quotas sont définis mais non bornés dans le seed v1.

Toute future limite commerciale passe par une nouvelle version de plan ou un entitlement explicite.

## 7. Managed

`managed_service` reste un overlay booléen/contractuel sur la subscription. Il n'existe pas de plan technique `MANAGED`.

## 8. Idempotence du seed

Le seed :
- upsert par codes stables ;
- ne supprime pas les codes historiques ;
- ne réécrit pas une version de plan déjà utilisée ;
- échoue si une modification destructive non versionnée est détectée ;
- peut être rejoué en CI et staging.
