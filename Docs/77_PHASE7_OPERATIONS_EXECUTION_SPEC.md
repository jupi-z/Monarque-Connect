# 77 — Spécification d'exécution Phase 7 — Operations

## Statut et autorité

Cette spécification a ouvert officiellement la Phase 7 — Operations sur la
baseline `main@3b7245469a2b9ee2a2ccb19c04f621d1d75497ec`, après la clôture
vérifiée de la Phase 6 — Purchases. La baseline courante après le Task 2 est
`main@9364379d868c536f9d4c7fe9da37934e4f5581e7`.

Le suivi GitHub est assuré par l'[issue #84](https://github.com/jupi-z/Monarque-Connect/issues/84).
Le présent document fige le périmètre et les invariants de conception. Il ne
constitue pas une validation fiscale, comptable, réglementaire ou contractuelle
propre à une juridiction.

À l'ouverture, aucune migration Prisma, aucun modèle Phase 7 et aucun endpoint
métier Phase 7 n'était autorisé avant validation du contrat et du plan issus de
ce cadrage. Le contrat a été gelé par la PR #86 ; le Task 2 a ensuite introduit
le ledger Inventory et sa projection par la PR #87. Les règles de cette
spécification restent normatives pour les tranches suivantes.

## Objectif

Livrer trois domaines opérationnels cohérents et indépendants des clients :

1. `Inventory` : écritures de mouvements et soldes de stock par organisation,
   établissement, entrepôt et article ;
2. `Expenses` : dépenses opérationnelles traçables, sans prétendre fournir un
   moteur comptable ou une qualification fiscale ;
3. `CashAccounts` / `CashMovements` : comptes de caisse et ledger de caisse,
   avec soldes dérivés d'écritures append-only.

Les trois domaines réutilisent la chaîne d'autorisation, les transactions
Prisma/PostgreSQL, les primitives Money/quantités, l'idempotence, l'audit et
la transactional outbox des phases précédentes.

## Périmètre inclus

- moteur Inventory unique et autoritaire ;
- mouvements entrants, sortants, ajustements et transferts ;
- projection reconstructible des soldes de quantité ;
- consommation idempotente des GoodsReceipts confirmées et corrigées ;
- affectation explicite des réceptions à un entrepôt ;
- import historique explicite et audité des réceptions antérieures ;
- dépenses enregistrées et annulées par transition explicite ;
- comptes de caisse établissement-scoped ;
- mouvements de caisse append-only, corrections compensatoires et références
  aux PaymentRecords/Expenses ;
- contrats HTTP/OpenAPI détaillés, événements versionnés, audit et preuves
  PostgreSQL/E2E.

## Hors périmètre

- valorisation FIFO/LIFO, coût moyen, écritures comptables ou grand livre ;
- TVA, retenues, facturation électronique ou obligation réglementaire nationale ;
- inventaire physique avancé, lots, séries, dates d'expiration et réservations ;
- rapprochement bancaire, processeur de paiement ou conversion de devises ;
- entrepôt fournisseur, portail fournisseur ou modification des GoodsReceipts
  Phase 6 ;
- second moteur de stock dans Purchases, Sales ou un module client ;
- refonte silencieuse des invariants des Phases 0 à 6.

## Invariants transverses

1. Toute requête suit l'ordre serveur : `tenant actif → membership actif →
   entitlement allowed → module actif → permission → scope établissement`.
2. Les modules canoniques sont `INVENTORY`, `EXPENSES` et `CASH`. Aucun service
   ne crée un entitlement local ou ne fait confiance à un type d'entreprise
   fourni par le client.
3. `organizationId`, `establishmentId`, `warehouseId`, `itemId`, compte,
   montant, quantité et rôle fournis par le client sont toujours revalidés
   côté serveur dans le tenant courant.
4. Toute ressource opérationnelle porte `organization_id`; toute ressource
   localisée porte `establishment_id`; les relations DB qualifient les clés
   par tenant.
5. Une mutation effective écrit état, audit et événement Outbox dans une seule
   transaction. Un rollback ne laisse aucune écriture partielle.
6. Une clé d'idempotence rejouée avec le même payload retourne le résultat
   existant ; la même clé avec un payload différent produit `409`.
7. Les écritures historiques ne sont pas modifiées en place. Une correction
   est une écriture compensatoire, liée à la source, motivée et auditée.
8. Les soldes exposés par l'API sont dérivés d'écritures valides. Aucun
   endpoint métier ne permet de modifier directement un solde.
9. Les décimaux sont calculés côté serveur avec les précisions existantes :
   quantités `numeric(19,6)` et montants `numeric(19,4)`, sérialisés en chaînes.
10. Les suppressions physiques de documents opérationnels et d'écritures sont
    interdites dans le périmètre MVP.

## Architecture Inventory

### Source d'autorité

`InventoryMovement` est un ledger append-only. Chaque ligne représente un
delta signé de quantité pour un article et un entrepôt déterminés. Le ledger
est la seule source d'autorité ; `InventoryBalance` est une projection
transactionnelle accélérant les lectures et reconstruisible depuis le ledger.

Une projection ne peut être modifiée que dans la même transaction que
l'écriture source. Une opération de reconstruction vérifie les sommes,
recalcule la projection et produit un audit de réconciliation ; elle ne peut
pas masquer un écart ni écraser une écriture source.

Chaque mouvement comporte au minimum :

- `id`, `organization_id`, `establishment_id`, `warehouse_id`, `item_id` ;
- `movement_type`, `quantity_delta`, `occurred_at` ;
- source (`reference_type`, `reference_id`, `reference_line_id`) ;
- `source_event_id?`, `source_revision?`, `reason?`, auteur et timestamps ;
- clé d'idempotence logique et hash de commande lorsque l'opération est une
  commande HTTP.

Les types v1 sont `RECEIPT_IN`, `SALE_OUT`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`,
`TRANSFER_OUT` et `TRANSFER_IN`. Un transfert crée deux écritures liées dans
la même transaction ; il ne modifie jamais directement un solde.

Les quantités négatives résultant d'une sortie, d'un transfert ou d'un
ajustement sont refusées par défaut. Une politique de stock négatif n'est pas
introduite implicitement ; si elle devient nécessaire, elle fera l'objet
d'une décision versionnée et de contrôles tenant explicites.

### Concurrence Inventory

- verrouillage déterministe de la clé `(organization, warehouse, item)` ;
- relecture du solde sous verrou avant toute sortie ;
- contrainte unique sur la source métier et la révision consommée ;
- impossibilité pour deux commandes concurrentes de consommer deux fois la
  même quantité disponible ;
- retry de transaction sur les conflits PostgreSQL autorisés et bornés ;
- test obligatoire de deux sorties concurrentes, deux imports concurrents et
  deux transferts croisés.

## Frontière GoodsReceipt Phase 6 / Inventory Phase 7

Phase 6 reste propriétaire du fait Purchases : une GoodsReceipt confirme ce
qui a été reçu contre une PurchaseOrder et publie ses événements. Elle ne
crée ni ne modifie de mouvement, de balance ou d'affectation Inventory.

Phase 7 consomme les événements versionnés suivants :

- `purchases.goods_receipt.confirmed.v1` : delta positif par ligne ;
- `purchases.goods_receipt.corrected.v1` : delta compensatoire signé par ligne.

Le consommateur ne poste un mouvement que si une affectation explicite à un
entrepôt existe. L'affectation est stockée dans une relation Phase 7
`GoodsReceiptInventoryLink`, qualifiée par organisation et réception, avec
entrepôt, statut, source de décision, auteur et timestamps. Elle ne réécrit
pas le document Phase 6.

Une réception sans affectation reste `PENDING_ASSIGNMENT` côté intégration et
n'a aucun effet de stock. L'API peut lister les réceptions en attente et
permettre à un membre autorisé de choisir un entrepôt actif du même
établissement. Un entrepôt par défaut ne peut être utilisé que si une
configuration explicite, active et auditée de l'établissement le définit ;
aucune déduction par nom, premier entrepôt ou article n'est autorisée.

### Déduplication, rejeu et corrections

La déduplication combine :

1. `consumer_name + source_event_id` pour le traitement de l'envelope ;
2. `organization_id + source_receipt_id + source_line_id + source_revision`
   pour empêcher un second mouvement effectif ;
3. une référence vers l'écriture Inventory produite pour l'audit et le rejeu.

Le consommateur enregistre sa receipt d'événement et le mouvement dans la
même transaction. Si la transaction est annulée, aucun receipt durable ne
doit empêcher un nouveau traitement. Un replay réussi retourne l'état déjà
appliqué sans créer une deuxième écriture.

Une correction GoodsReceipt produit un delta Inventory compensatoire lié à la
ligne corrigée. Elle ne modifie pas le mouvement initial. Une correction qui
rendrait le cumul négatif ou franchirait les invariants de quantité est
refusée. Une annulation d'une réception déjà postée ne passe pas par une
suppression : elle exige une correction compensatoire explicite selon le
contrat Purchases.

### Réceptions historiques

Il n'y a pas de backfill automatique lors du déploiement Phase 7. Les
réceptions historiques sont traitées ainsi :

- événement Outbox historique disponible : rejeu contrôlé du consommateur,
  après affectation explicite ;
- aucun événement disponible : commande d'import historique explicite,
  idempotente et auditée, produisant une révision `HISTORICAL_IMPORT` ;
- affectation manquante ou entrepôt inactif : aucune écriture Inventory ;
- import partiellement traité : reprise par source et révision, sans double
  comptabilisation.

La politique et les résultats d'import sont visibles dans l'audit et ne
modifient pas les données historiques de Purchases.

## Expenses

Une `Expense` est un fait opérationnel non comptable. Elle est rattachée à
une organisation et un établissement, porte une description, une catégorie,
un montant, une devise, une date de dépense et une référence optionnelle vers
un `BusinessParty`. Les domaines `Projects` et `Documents` ne possèdent pas
encore de modèle propriétaire livré : Expenses v1 ne stocke donc pas de
références UUID opaques non validables ; ces liens seront ajoutés avec les
contraintes composites de leurs domaines respectifs. De même, aucun lien vers
Cash n'est créé avant la Task 5.

Transitions v1 : `DRAFT → RECORDED → VOID`. Seul `DRAFT` est éditable. `VOID`
est terminal et motivé. Une dépense enregistrée ne peut pas être réécrite
pour corriger son montant ; une correction financière éventuelle est une
opération séparée et explicitement liée.

La transition `RECORDED` ne crée aucun mouvement Cash dans la Task 4. La Task
5 pourra ajouter un lien idempotent vers un `CashMovement OUT` sans réécrire
le fait Expense ; aucun compte de caisse n'est choisi ou créé par Expenses v1.

## CashAccounts et CashMovements

Un `CashAccount` appartient à un établissement, possède un code unique dans
le tenant, une devise et un état `ACTIVE | INACTIVE`. Son solde n'est jamais
un champ mutable de vérité.

Un `CashMovement` append-only porte `IN | OUT`, un montant strictement positif,
la devise du compte, la date d'occurrence, une raison, l'auteur et une source
optionnelle (`PaymentRecord`, `Expense`, transfert ou correction). Le solde
est `somme(IN) - somme(OUT)` des écritures valides. Une correction est un
mouvement inverse avec référence à l'écriture corrigée ; il n'existe pas de
delete ni d'édition silencieuse.

Les transferts entre comptes créent deux écritures liées dans une transaction.
Les devises des deux comptes doivent être identiques ; aucune conversion
implicite n'est autorisée. La concurrence verrouille les comptes dans l'ordre
croissant de leur identifiant et refuse un solde insuffisant pour une sortie.

## Autorisation, entitlements et scopes

Les permissions centrales proposées sont :

- `inventory:read`, `inventory:write` ;
- `expenses:read`, `expenses:write` ;
- `cash:read`, `cash:write`.

Matrice v1 :

| Domaine | OWNER | ADMIN | SALES | FINANCE | OPERATIONS | VIEWER |
|---|---:|---:|---:|---:|---:|---:|
| Inventory read/write | ✓/✓ | ✓/✓ | –/– | ✓/– | ✓/✓ | ✓/– |
| Expenses read/write | ✓/✓ | ✓/✓ | –/– | ✓/✓ | ✓/✓ | ✓/– |
| Cash read/write | ✓/✓ | ✓/✓ | –/– | ✓/✓ | ✓/– | ✓/– |

Chaque route appelle `AuthorizationService.requireModule()` avec le module
canonique et vérifie ensuite l'établissement par le contexte de scope. Une
réception Network, une dépense référencée ou un PaymentRecord lié ne contourne
jamais l'autorisation du tenant propriétaire de l'écriture.

## Contrat API-first réservé

Le contrat autoritaire reste `openapi/openapi.yaml`, sous `/api/v1`. Les
opérations suivantes doivent être détaillées avant la première migration :

### Inventory

- `GET /organizations/{organizationId}/inventory/balances` ;
- `GET /organizations/{organizationId}/inventory/movements` ;
- `POST /organizations/{organizationId}/inventory/movements` ;
- `POST /organizations/{organizationId}/inventory/transfers` ;
- `GET /organizations/{organizationId}/inventory/goods-receipts/pending` ;
- `POST /organizations/{organizationId}/inventory/goods-receipts/{receiptId}/assignment` ;
- `POST /organizations/{organizationId}/inventory/goods-receipts/{receiptId}/import` ;
- `POST /organizations/{organizationId}/inventory/reconciliation`.

### Expenses

- `GET/POST /organizations/{organizationId}/expenses` ;
- `GET/PATCH /organizations/{organizationId}/expenses/{expenseId}` ;
- `POST /organizations/{organizationId}/expenses/{expenseId}/record` ;
- `POST /organizations/{organizationId}/expenses/{expenseId}/void`.

### Cash

- `GET/POST /organizations/{organizationId}/cash-accounts` ;
- `GET/PATCH /organizations/{organizationId}/cash-accounts/{cashAccountId}` ;
- `POST /organizations/{organizationId}/cash-accounts/{cashAccountId}/deactivate` ;
- `POST /organizations/{organizationId}/cash-accounts/{cashAccountId}/reactivate` ;
- `GET/POST /organizations/{organizationId}/cash-movements` ;
- `POST /organizations/{organizationId}/cash-movements/{movementId}/correct` ;
- `POST /organizations/{organizationId}/cash-transfers`.

Toutes les mutations utilisent `Idempotency-Key`, Problem Details et les
erreurs `400/401/403/404/409`. Les réponses utilisent des chaînes décimales,
des curseurs de pagination et exposent la source, la révision et l'état
pertinents sans divulguer de données privées d'un autre tenant.

## Événements et audit

Événements minimaux à versionner :

- `inventory.movement.created.v1`, `inventory.transfer.created.v1` ;
- `inventory.goods_receipt.assigned.v1`,
  `inventory.goods_receipt.imported.v1` ;
- `inventory.balance.reconciled.v1` ;
- `expenses.created.v1`, `expenses.recorded.v1`, `expenses.voided.v1` ;
- `cash.account.created.v1`, `cash.account.status_changed.v1` ;
- `cash.movement.created.v1`, `cash.movement.corrected.v1`,
  `cash.transfer.created.v1`.

Chaque événement utilise l'envelope canonique avec tenant, établissement,
acteur, aggregate, corrélation, request ID, classification et finalité. Les
payloads contiennent les identifiants, statuts, deltas et références
nécessaires ; ils ne copient ni secrets, ni dump ORM, ni données privées
inutiles.

Les actions sensibles sont auditées : mouvement, import, affectation,
réconciliation, création/annulation Expense, création/correction CashMovement,
transfert et changement d'état de compte.

## Migrations et preuves obligatoires

Les migrations seront additives et devront prouver :

1. base vide depuis toutes les migrations jusqu'à Phase 7 ;
2. upgrade depuis `main@3b7245469a2b9ee2a2ccb19c04f621d1d75497ec` ;
3. intégrité tenant/établissement/entrepôt/article et tenant/compte ;
4. unicité des sources, révisions, idempotency keys et codes de compte ;
5. absence de double mouvement lors des retries, replays et imports concurrents ;
6. reconstruction des balances depuis les ledgers ;
7. seed idempotent sans données opérationnelles fictives ;
8. migrations Phase 0 à 6 inchangées et non destructives.

## Tests obligatoires avant clôture

- validation OpenAPI et contrats machine-readable ;
- matrice entitlement/activation/permission/scope pour les trois modules ;
- isolation tenant et établissement sur chaque lecture et mutation ;
- mouvement positif, négatif, transfert et refus du stock négatif ;
- deux sorties concurrentes et deux imports concurrents ;
- replay d'événement sans deuxième mouvement ;
- correction GoodsReceipt compensatoire et cumul cohérent ;
- réception sans entrepôt, entrepôt inactif et import historique explicite ;
- rollback état + audit + Outbox + receipt consommateur ;
- Expense enregistrée, annulation idempotente et lien de paiement ;
- CashMovement, correction, transfert concurrent et solde insuffisant ;
- devise incompatible refusée sans conversion implicite ;
- réconciliation qui détecte un écart sans le masquer ;
- migrations base vide et upgrade Phase 6 ;
- E2E GoodsReceipt → Inventory, Expense → Cash et Cash transfer ;
- non-régression complète des Phases 0 à 6, build, smoke HTTP et CI.

## Gate d'ouverture de l'implémentation

Avant toute migration ou code métier, une PR de cadrage doit valider :

- la présente frontière Phase 6/7 ;
- les modèles proposés et contraintes PostgreSQL ;
- les permissions et entitlements ;
- le contrat OpenAPI détaillé ;
- les événements, l'idempotence, la concurrence et les preuves attendues.

Une ambiguïté sur l'affectation des réceptions, le stock négatif, la
correction d'écriture, les liens Sales/Purchases ou la devise bloque
l'implémentation jusqu'à décision documentée.

## Gate de sortie de Phase 7

La phase ne pourra être déclarée terminée qu'après preuve effective de tous
les gates de l'issue #84 : contrats, modèle unique Inventory, intégration
GoodsReceipt, historiques, Expenses, Cash, autorisation, tenant isolation,
audit, Outbox, idempotence, concurrence, migrations, PostgreSQL, E2E,
non-régression, CI PR, CI post-merge, documentation et suppression des
branches de livraison.
