# 04 — Modèle métier

## Identity
`User` : identité globale authentifiable.  
`RefreshSession` : session rotative révocable.  
`PlatformRole` : droit Monarque Group séparé des droits tenant.

## Organization
`Organization` : tenant.  
`Membership` : relation User ↔ Organization avec rôle.  
`Invitation` : invitation membre avec expiration et usage unique.

## Party
`BusinessParty` : client, fournisseur ou les deux, propre à une organisation. Peut être lié à une autre organisation du réseau sans partager ses données privées.

## Catalog
`Item` : `PRODUCT | SERVICE`. Prix de référence, unité, SKU optionnel.  
`Warehouse` : emplacement de stock.  
`StockMovement` : écriture de stock durable.

## CRM
`Lead` et `Opportunity`. Une opportunity peut référencer un party et conduire à un devis.

## Sales
`Quote` : `DRAFT | SENT | ACCEPTED | REJECTED | EXPIRED | CANCELLED`.  
`SalesOrder` : `DRAFT | CONFIRMED | FULFILLED | CANCELLED`.  
`Invoice` : `DRAFT | ISSUED | PARTIALLY_PAID | PAID | VOID`.  
`PaymentRecord` : enregistrement d'un encaissement réel ; ce n'est pas un processeur de paiement.

Les lignes de documents sont des snapshots : libellé, quantité, prix unitaire, remise/taxe éventuelle et totaux.

## Expenses
`Expense` : dépense enregistrée avec montant, devise, catégorie, date et justificatif optionnel.

## Network
`OrganizationProfile` : projection publique opt-in.  
`ConnectionRequest` : demande B2B.  
`BusinessConnection` : relation acceptée.

## Messaging
`Conversation` : relation entre deux organisations autorisées.  
`Message` : message immuable, auteur utilisateur + organisation d'origine.

## Documents
`Document` : métadonnées métier.  
`MediaObject` : objet de stockage.  
`AuditEvent` : trace immuable des actions sensibles.  
`OutboxEvent` : événement durable d'intégration.
