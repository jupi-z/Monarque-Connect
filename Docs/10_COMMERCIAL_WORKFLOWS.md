# 10 — Workflows commerciaux

## 1. Entrée réseau → CRM

Une `NetworkInquiry` reçue peut être :
`NEW → QUALIFIED | DISMISSED | CONVERTED`.

La conversion crée de manière idempotente un `Lead` ou une `Opportunity` et conserve la référence à l'inquiry source.

## 2. CRM

`Lead → Qualified → Opportunity → Quote`.

Une Opportunity est établissement-scopée dès qu'elle entre dans l'exécution commerciale.

## 3. Quote

`DRAFT → SENT → ACCEPTED | REJECTED | EXPIRED | CANCELLED`.

Une quote acceptée peut créer une SalesOrder de manière idempotente.

## 4. Order

`DRAFT → CONFIRMED → FULFILLED | CANCELLED`.

La fulfillment d'un produit stocké crée les mouvements `SALE_OUT`. Toute transition est contrôlée par entitlement `SALES`, rôle et scope d'établissement.

## 5. Invoice

`DRAFT → ISSUED → PARTIALLY_PAID → PAID`.

`VOID` est explicite et auditée. Pas d'édition silencieuse après `ISSUED`.

## 6. PaymentRecord

Enregistre un paiement constaté. Pas de débit carte/mobile money dans le MVP.

Si un encaissement est reçu en caisse, l'opération peut créer transactionnellement :
- le `PaymentRecord` ;
- le `CashMovement IN` correspondant.

Le lien entre les deux est durable et idempotent.

## 7. Purchases

### Supplier RFQ
`DRAFT → SENT → CLOSED | CANCELLED`.

Une RFQ peut viser :
- un fournisseur local (`BusinessParty`) ;
- une organisation Monarque Connect connectée.

### Purchase Order
`DRAFT → SENT → CONFIRMED → PARTIALLY_RECEIVED → RECEIVED | CANCELLED`.

### Goods Receipt
Une réception confirmée :
- fige les quantités reçues ;
- publie un événement Purchases versionné ;
- ne crée aucun mouvement de stock dans le domaine Purchases ;
- est consommée par le moteur Inventory de Phase 7 seulement après une
  affectation explicite à un entrepôt ;
- ne peut pas produire deux écritures Inventory à cause de la déduplication
  événement/source/révision.

## 8. Expenses

`RECORDED → VOID`.

Une correction se fait par annulation/écriture compensatoire selon le type de donnée, jamais par réécriture historique silencieuse.

Une dépense payée depuis une caisse crée ou référence un `CashMovement OUT`.

## 9. Cash

Un `CashAccount` appartient à un établissement.

`CashMovement` est append-only :
- `IN` : encaissement, apport, correction positive documentée ;
- `OUT` : dépense, retrait, correction négative documentée.

Le solde est dérivé des mouvements valides. Aucun endpoint standard ne permet de modifier directement le solde.

## 10. Projects

`PLANNED → ACTIVE → COMPLETED | CANCELLED`.

Les tâches :
`TODO → IN_PROGRESS → DONE | CANCELLED`.

Un projet peut être relié à un client, une opportunity, des dépenses et des documents. Le MVP ne devient pas un outil de gestion de projet avancé.

## 11. Numérotation

Quote, Order, Invoice, SupplierRFQ et PurchaseOrder utilisent une séquence transactionnelle. La politique peut être organization-wide ou par établissement, mais elle est fixée avant émission et ne change pas rétroactivement les documents existants.

## 12. Entitlements

Chaque workflow vérifie son module :
- CRM → `CRM`
- Quote/Order/Invoice → `SALES`
- RFQ/PO/Receipt → `PURCHASES`
- Stock → `INVENTORY`
- Cash → `CASH`
- Projects → `PROJECTS`

Le frontend ne peut pas rendre une opération valide si le backend la refuse.
