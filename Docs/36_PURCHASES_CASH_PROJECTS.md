# 36 — Achats, caisse et projets légers

## 1. Achats

### Supplier RFQ
Objectif : demander un prix sans créer un système d'appel d'offres complexe.

Une RFQ contient :
- établissement ;
- besoin/date ;
- lignes ;
- fournisseurs destinataires.

Destinataire = `BusinessParty` ou organization réseau.

États :
`DRAFT → SENT → CLOSED | CANCELLED`.

### Purchase Order
États :
`DRAFT → SENT → CONFIRMED → PARTIALLY_RECEIVED → RECEIVED | CANCELLED`.

Lignes snapshotées.

### Goods Receipt
Une réception confirmée est immuable fonctionnellement ; une correction utilise une opération compensatoire. Elle génère les mouvements stock entrants une seule fois.

## 2. Caisse

### CashAccount
Une caisse :
- appartient à un établissement ;
- possède une devise ;
- n'a pas de solde modifiable directement.

### CashMovement
`IN | OUT`, append-only.

Origines possibles :
- payment record ;
- expense ;
- manual adjustment autorisé avec raison.

Le solde = somme des mouvements valides.

Pour une correction : mouvement inverse/compensatoire, audit et référence à l'écriture corrigée.

## 3. Projets légers

Le module PROJECTS sert aux prestataires et aux opérations simples, sans devenir Jira/MS Project.

### Project
- client optionnel ;
- opportunity optionnelle ;
- établissement ;
- dates ;
- statut ;
- description.

États :
`PLANNED → ACTIVE → COMPLETED | CANCELLED`.

### Task
- titre ;
- responsable membership optionnel ;
- échéance ;
- statut.

États :
`TODO → IN_PROGRESS → DONE | CANCELLED`.

## 4. Liens transverses

- Expense peut référencer Project ;
- Document peut être attaché à Project/RFQ/PO/Receipt ;
- Opportunity peut créer Project après accord ;
- GoodsReceipt alimente Inventory ;
- PaymentRecord/Expense peuvent alimenter Cash.

## 5. Permissions / entitlements

- achats : module `PURCHASES` ;
- caisse : `CASH` ;
- projets : `PROJECTS`.

Chaque écriture vérifie établissement et rôle.
