# 74 — Spécification d'exécution Phase 6 — Purchases

## Statut et autorité

Cette spécification ouvre la Phase 6 sur la baseline
`main@623fa9e79947e4608f7d2c66d841d053b22684e2`, après la clôture vérifiée de
la Phase 5 — Sales. Elle est normative pour le périmètre, les modèles, les
transitions, l'autorisation, les contrats API, les événements et les preuves.

Le suivi GitHub est assuré par l'[issue #75](https://github.com/jupi-z/Monarque-Connect/issues/75).
La spécification ne constitue pas une validation fiscale, comptable,
réglementaire ou contractuelle propre à une juridiction.

## Objectif

Livrer une chaîne d'achat tenant-scoped et establishment-scoped :

`SupplierRFQ → PurchaseOrder → GoodsReceipt`

Les documents doivent rester lisibles, auditables, idempotents et
rejouables. La réception constate un fait opérationnel ; elle ne devient pas
encore un mouvement de stock dans cette phase.

## Périmètre inclus

- RFQ fournisseur créée par une organisation acheteuse ;
- envoi d'une même RFQ à plusieurs fournisseurs indépendants ;
- fournisseurs locaux représentés par `BusinessParty` et fournisseurs Network
  admissibles ;
- snapshots des lignes, fournisseurs et conditions techniques nécessaires à
  l'historique ;
- création directe d'un PurchaseOrder ou depuis une attribution partielle
  d'une RFQ ;
- transitions explicites et idempotentes des RFQ et PurchaseOrders ;
- GoodsReceipts confirmées totales ou partielles ;
- cumul et contrôle transactionnels des quantités reçues ;
- corrections compensatoires, motivées et auditées ;
- contrats OpenAPI détaillés, événements versionnés, audit, Outbox,
  idempotence et preuves PostgreSQL.

## Hors périmètre

- portail fournisseur ou réponse autonome du fournisseur à une RFQ ;
- moteur d'appel d'offres, classement automatique ou enchère ;
- factures fournisseur, paiements, rapprochement ou comptabilité ;
- mouvements de stock, réservations, coût moyen, valorisation ou solde
  d'entrepôt ; ces fonctions appartiennent à la Phase 7 — Operations ;
- synchronisation avec un ERP ou un transporteur ;
- règles fiscales nationales, retenues, obligations de facture électronique ou
  qualification juridique d'un fournisseur ;
- multi-devise avec conversion ou taux de change ;
- hard delete des documents transactionnels.

## Frontière Phase 6 / Phase 7 — Inventory

Une `GoodsReceipt` Phase 6 est la preuve que l'organisation a constaté une
réception contre un PurchaseOrder. Sa confirmation écrit uniquement le
document, son audit et son événement Outbox `purchases.goods_receipt.*`.

Phase 6 ne crée ni ne modifie `StockMovement`, `Warehouse`, quantité
disponible, réservation, coût ou solde de stock. Aucun service Purchases ne
doit appeler un futur moteur Inventory ni créer une projection locale de
stock.

La Phase 7 pourra consommer un contrat d'intégration versionné à partir des
événements de réception. Elle décidera alors, dans sa propre transaction et
avec ses propres invariants, si une réception confirmée est importée dans
Inventory. Une réception ne sera jamais appliquée deux fois par ce futur
consommateur : la clé d'événement et l'identité du document constitueront sa
clé de déduplication. Toute évolution de ce contrat nécessitera un ADR et une
spécification versionnée ; elle ne peut pas être introduite silencieusement
dans Phase 6.

## Invariants non négociables

1. Toute opération privée suit l'ordre serveur :
   `tenant actif → membership actif → entitlement PURCHASES → module PURCHASES actif → permission → scope établissement`.
2. `organizationId`, `establishmentId`, rôle, module, fournisseur, prix ou
   quantité fournis par le client ne constituent jamais une preuve d'autorité.
3. Chaque document et chaque ligne portent l'organisation émettrice. Les
   relations établissement et parties utilisent une intégrité qualifiée par
   `organization_id`.
4. Un membre `SELECTED_ESTABLISHMENTS` ne peut ni lire, ni modifier, ni
   agréger une RFQ, une commande ou une réception d'un autre établissement.
5. Une mutation effective écrit l'état, l'audit et l'événement Outbox dans la
   même transaction Prisma.
6. Une même clé d'idempotence et une charge différente produisent un conflit ;
   un retry effectif ne crée ni doublon, ni second audit, ni second événement.
7. Les documents envoyés/confirmés et les réceptions confirmées sont
   fonctionnellement immuables. Une correction est compensatoire, motivée et
   liée à l'écriture corrigée.
8. Les données privées du tenant acheteur ne sont jamais rendues visibles à
   un autre tenant. Un fournisseur Network ne voit que sa propre RFQ et les
   champs explicitement partagés.
9. `PURCHASES` est le seul entitlement métier requis par les trois agrégats.
   Aucun service ne crée d'entitlement local.
10. Les montants sont calculés côté serveur avec les primitives Money de
    Phase 5 et sérialisés comme chaînes décimales. Aucune conversion de devise
    implicite n'est appliquée.
11. Les quantités sont des décimaux positifs à précision déterministe. Une
    réception ne peut pas rendre la quantité cumulée nette négative.

## Autorisation, entitlements et scopes

Le module canonique est `PURCHASES`. Toute route privée doit réutiliser
`AuthorizationService.requireModule(principal, organizationId, 'PURCHASES', permission)`
et le contexte de scope retourné. Le rôle ne contourne jamais un entitlement
absent, suspendu ou désactivé.

Permissions à ajouter à la matrice centrale :

- `purchases:rfqs:read`, `purchases:rfqs:write` ;
- `purchases:orders:read`, `purchases:orders:write` ;
- `purchases:receipts:read`, `purchases:receipts:write`.

| Domaine | OWNER | ADMIN | SALES | FINANCE | OPERATIONS | VIEWER |
|---|---:|---:|---:|---:|---:|---:|
| RFQ read/write | ✓/✓ | ✓/✓ | –/– | ✓/– | ✓/✓ | ✓/– |
| PurchaseOrder read/write | ✓/✓ | ✓/✓ | –/– | ✓/– | ✓/✓ | ✓/– |
| GoodsReceipt read/write | ✓/✓ | ✓/✓ | –/– | ✓/– | ✓/✓ | ✓/– |

Cette matrice fixe le droit métier ; l'établissement reste vérifié pour
chaque opération. Une organisation Network destinataire n'obtient jamais un
membership dans l'organisation acheteuse.

## RFQ multi-fournisseurs et Network

Une `SupplierRFQ` est un agrégat de l'organisation acheteuse et d'un seul
établissement. Elle contient plusieurs `SupplierRFQRecipient`, chacun
pointant soit vers un `BusinessParty` local de type `SUPPLIER` ou `BOTH`, soit
vers une organisation Network admissible.

Une RFQ peut être envoyée à plusieurs destinataires dans une transaction ;
chaque destinataire reçoit une projection indépendante avec son propre statut.
Les statuts et éventuelles données privées d'un destinataire ne sont jamais
retournés dans la vue d'un autre destinataire. Phase 6 ne fournit pas de
portail de réponse fournisseur : une attribution est saisie par un membre
autorisé de l'organisation acheteuse à partir des informations qu'il détient.

Un fournisseur local doit appartenir au tenant acheteur et être actif. Une
cible Network doit être une organisation active, disposer d'un profil public
permettant le contact et d'une connexion Network `ACCEPTED` entre les deux
organisations. Seuls l'identifiant de la cible, son nom public, les lignes
explicitement adressées et les champs de contact autorisés sont partagés.
Les memberships, entitlements, prix privés, stock interne et documents du
fournisseur restent invisibles.

Une RFQ ne peut pas cibler l'organisation acheteuse elle-même. Les doublons de
destinataire sont refusés avant envoi et par contrainte unique. La fermeture
de la RFQ ne supprime aucun destinataire et conserve l'audit.

## Modèle métier normatif

### SupplierRFQ

Champs minimaux : `id`, `organization_id`, `establishment_id`, `number`,
`status`, `title`, `needed_by?`, `currency`, `notes?`, créateur et timestamps.
Une RFQ démarre `DRAFT` et porte des `SupplierRFQLine` et
`SupplierRFQRecipient`.

Une ligne contient `line_index`, `item_id?`, `item_name_snapshot`,
`item_sku_snapshot?`, `description_snapshot?`, `unit_snapshot`, `quantity`
positive et `requested_by?`. Les items doivent être actifs et appartenir au
tenant à la création ; les snapshots deviennent l'autorité historique.

Un destinataire contient `recipient_kind` (`LOCAL_PARTY` ou
`NETWORK_ORGANIZATION`), l'identifiant qualifié de la partie ou organisation,
`display_name_snapshot`, `status`, `sent_at?`, `responded_at?` et timestamps.
La réponse commerciale structurée n'est pas un sous-système de Phase 6.

### PurchaseOrder

Champs minimaux : `id`, `organization_id`, `establishment_id`, `number`,
`status`, `supplier_party_id?`, `supplier_organization_id?`,
`source_rfq_id?`, `source_rfq_recipient_id?`, `currency`, `ordered_at?`,
notes, créateur et timestamps.

Un PurchaseOrder référence au plus une cible fournisseur et snapshotte le
nom, le type de cible et les coordonnées explicitement nécessaires. Une
commande peut être créée directement ou depuis une attribution partielle de
RFQ. Une attribution issue d'une RFQ ne peut utiliser que les lignes de la
RFQ et ne peut produire qu'une commande par destinataire ; plusieurs
destinataires peuvent donc produire plusieurs commandes indépendantes.

Une ligne contient `line_index`, `source_rfq_line_id?`, `item_id?`, les
snapshots de l'item, `quantity_ordered`, `unit_price`, `discount_amount`,
`tax_mode`, `tax_code_snapshot?`, `tax_rate`, `net_amount`, `tax_amount` et
`gross_amount`. Les totaux sont calculés et stockés côté serveur.

### GoodsReceipt

Champs minimaux : `id`, `organization_id`, `establishment_id`, `number`,
`purchase_order_id`, `status`, `received_at`, `reference?`, `notes?`,
créateur et timestamps. Une réception contient des lignes qui référencent les
lignes de commande et snapshotent l'unité, l'item et la quantité reçue.

Les quantités dérivées sont :

`net_received(line) = somme(confirmations) + somme(corrections signées)`

`remaining(line) = quantity_ordered - net_received(line)`.

La confirmation refuse par défaut tout delta qui rendrait `net_received` >
`quantity_ordered`. Il n'existe pas de tolérance cachée ni de dépassement
commercial implicite dans Phase 6. Une future politique de tolérance devra
être une décision versionnée et une règle explicitement autorisée par
organisation.

### GoodsReceiptCorrection

Une correction est append-only, liée à une réception et une ligne existantes,
avec `delta_quantity` non nul signé, raison obligatoire, auteur, timestamp,
idempotency key et référence au document corrigé. Le serveur verrouille la
commande et les lignes concernées, refuse un cumul net négatif et conserve
l'historique. Une correction ne modifie jamais la ligne originale.

## Transitions

| Agrégat | Transitions autorisées | Règle |
|---|---|---|
| SupplierRFQ | `DRAFT → SENT → CLOSED \| CANCELLED` | Seul `DRAFT` est éditable ; `SENT` est adressée aux destinataires ; `CLOSED` est terminale. |
| Recipient | `PENDING → SENT → SELECTED \| DECLINED \| CANCELLED` | Les transitions sont autorisées selon l'autorité de l'acheteur ; un autre fournisseur ne voit pas ce statut. |
| PurchaseOrder | `DRAFT → SENT → CONFIRMED → PARTIALLY_RECEIVED → RECEIVED \| CANCELLED` | Seul `DRAFT` est éditable ; `CANCELLED` est interdit après une réception confirmée. |
| GoodsReceipt | `DRAFT → CONFIRMED \| CANCELLED` | Une réception confirmée est terminale ; la correction est compensatoire et append-only. |

`CONFIRMED` est l'état d'acceptation interne de la commande. Une première
réception fait passer la commande à `PARTIALLY_RECEIVED` si le cumul est
inférieur aux quantités commandées, sinon à `RECEIVED`. Toute réception
ultérieure d'une commande `RECEIVED` est refusée. Les transitions terminales
ne sont jamais inversées silencieusement.

## Numérotation, argent et quantités

Les compteurs sont transactionnels, organisation-wide, par type de document
et année civile UTC, avec la primitive de Phase 5 et une contrainte unique :

- RFQ : `RFQ-YYYY-NNNNNN` ;
- PurchaseOrder : `PO-YYYY-NNNNNN` ;
- GoodsReceipt : `GR-YYYY-NNNNNN`.

Les trous après rollback sont acceptés ; les doublons ne le sont pas. Les
montants de commande réutilisent `numeric(19,4)`, les quantités
`numeric(19,6)`, l'arrondi serveur `HALF_UP` et la sérialisation décimale en
chaîne de Phase 5. La devise doit être la devise par défaut de l'organisation.
Les taxes sont techniques, explicites et snapshotées ; aucune règle fiscale
ou comptable nationale n'est déduite. Les RFQ sans prix ne calculent aucun
total ; les GoodsReceipts ne créent aucune écriture financière.

## Contrat API-first figé

Le contrat autoritaire est `openapi/openapi.yaml`, sous `/api/v1`. Toutes les
mutations acceptent `Idempotency-Key` et retournent les Problem Details
existants. Les schémas devront utiliser des décimaux sous forme de chaînes,
des curseurs de pagination et documenter `400`, `401`, `403`, `404` et `409`.

Routes et opérations réservées à l'implémentation :

- `GET/POST /organizations/{organizationId}/supplier-rfqs` ;
- `GET/PATCH /organizations/{organizationId}/supplier-rfqs/{rfqId}` ;
- `POST .../supplier-rfqs/{rfqId}/send|close|cancel` ;
- `GET/POST /organizations/{organizationId}/purchase-orders` ;
- `GET/PATCH /organizations/{organizationId}/purchase-orders/{purchaseOrderId}` ;
- `POST .../purchase-orders/{purchaseOrderId}/send|confirm|cancel` ;
- `GET /organizations/{organizationId}/purchase-orders/{purchaseOrderId}/receipts` ;
- `POST .../purchase-orders/{purchaseOrderId}/receipts` ;
- `GET .../receipts/{receiptId}` ;
- `POST .../receipts/{receiptId}/correct`.

Les mutations de collection exigent `organizationId` serveur cohérent,
`establishmentId` dans le corps seulement comme cible à vérifier, et un
payload de transition limité à l'état ou à la raison. Aucun endpoint public
Network ne retourne une RFQ privée ; aucun endpoint fournisseur n'est ajouté
sans spécification d'identité et d'autorité séparée.

## Événements et audit

Les événements versionnés minimaux sont :

- `purchases.supplier_rfq.created.v1`, `purchases.supplier_rfq.updated.v1`,
  `purchases.supplier_rfq.status_changed.v1`,
  `purchases.supplier_rfq.recipient_sent.v1` ;
- `purchases.purchase_order.created.v1`, `purchases.purchase_order.updated.v1`,
  `purchases.purchase_order.status_changed.v1` ;
- `purchases.goods_receipt.created.v1`,
  `purchases.goods_receipt.confirmed.v1`,
  `purchases.goods_receipt.corrected.v1`.

Chaque envelope reprend le contrat canonique, `organizationId`,
`establishmentId`, acteur, agrégat, corrélation, request ID et classification
`CONFIDENTIAL`. Le payload est minimal : identifiant, numéro, statut, source,
version et identifiants de lignes nécessaires à la consommation. Il ne copie
pas les notes privées, credentials, données d'authentification, prix d'un
autre fournisseur ni données Network non publiques.

Les actions d'audit couvrent création, édition DRAFT, envoi, sélection,
fermeture, annulation, confirmation, réception et correction. Les mutations
état + audit + Outbox sont une seule unité transactionnelle ; un rollback ne
laisse aucune trace partielle.

## Idempotence et concurrence

- les mutations utilisent l'idempotence existante, scopée par organisation,
  acteur et opération ;
- les doublons de destinataire, source RFQ/recipient et clés métier sont
  refusés par application et contraintes PostgreSQL ;
- l'envoi d'une RFQ verrouille sa ligne et traite les destinataires de manière
  déterministe ; deux envois concurrents ne produisent pas deux événements
  effectifs par destinataire ;
- la création d'un numéro verrouille le compteur organisation/type/année ;
- la confirmation d'une réception verrouille la commande et toutes les lignes
  concernées dans un ordre déterministe, recalcule le cumul et refuse le
  dépassement ;
- deux réceptions concurrentes ne peuvent pas toutes deux consommer la même
  quantité restante ; une seule gagne et l'autre reçoit un conflit contrôlé ;
- une correction concurrente réutilisant la même clé est idempotente et une
  correction différente est rejetée si elle rend le cumul négatif ;
- toute transition répétée renvoie l'état déjà obtenu sans second audit ni
  nouvel événement effectif.

## Migrations et preuves

Les migrations seront additives et devront prouver :

1. reconstruction d'une base vide depuis toutes les migrations ;
2. upgrade depuis `main@623fa9e79947e4608f7d2c66d841d053b22684e2` ;
3. intégrité qualifiée tenant/établissement pour chaque agrégat et ligne ;
4. unicité des numéros, sources, destinataires et idempotency keys ;
5. indexes de listes par organisation, établissement, statut et date ;
6. absence de données métier fictives dans le seed ;
7. absence de table ou projection de stock créée par Phase 6.

Un script dédié `npm run prisma:phase6:migration-proof` sera ajouté pendant
l'implémentation et exécuté dans la CI avec PostgreSQL réel.

## Tests obligatoires avant clôture

- validation OpenAPI des routes et schémas détaillés ;
- matrice d'autorisation, entitlement absent/désactivé et scopes sélectionnés ;
- RFQ multi-fournisseurs avec isolation des statuts et prix ;
- RFQ locale, RFQ Network admissible, cible inactive, non-connectée et
  auto-ciblage refusés ;
- transitions autorisées, interdites et terminales ;
- attribution partielle d'une RFQ vers plusieurs PurchaseOrders ;
- snapshots immuables et calculs monétaires déterministes ;
- réception totale, réceptions partielles et cumul exact ;
- dépassement, annulation après réception et correction négative contrôlée ;
- deux réceptions concurrentes et deux numéros concurrents ;
- retry idempotent sans second audit/Outbox ;
- rollback état + audit + Outbox ;
- isolation tenant/établissement et absence d'accès Network privé ;
- preuve qu'aucune table, écriture ou projection Inventory n'est produite ;
- migrations base vide et upgrade depuis Phase 5 ;
- E2E `SupplierRFQ → PurchaseOrder → GoodsReceipt` ;
- non-régression complète des Phases 0 à 5, build et smoke HTTP.

## Gate d'ouverture de l'implémentation

Avant toute migration ou code métier, une PR de cadrage doit valider cette
spécification, la matrice des permissions et le contrat OpenAPI détaillé. Une
ambiguïté sur l'identité d'un fournisseur Network, une règle de dépassement,
une correction ou l'interface Phase 7 bloque l'implémentation jusqu'à décision
documentée.

## Gate de sortie de Phase 6

La phase ne pourra être déclarée terminée qu'après preuve effective de tous
les gates de l'issue #75 : modèles, transitions, authorization, RFQ
multi-fournisseurs, isolation Network, réception partielle/cumulative,
corrections, frontière Inventory, OpenAPI, événements, audit, idempotence,
concurrence, migrations, PostgreSQL, E2E, non-régression, CI PR, CI
post-merge, documentation synchronisée et suppression des branches.

## Décisions différées

Sont explicitement hors décision de cette ouverture : conformité fiscale,
comptabilité, facture fournisseur, paiement, conversion de devises,
tolérances commerciales de dépassement, portail fournisseur et contrat final
d'import Inventory. Chaque extension exige une décision versionnée avant
implémentation.
