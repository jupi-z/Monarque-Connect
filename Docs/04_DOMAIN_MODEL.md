# 04 — Modèle métier

## Identity

`User` : identité globale authentifiable.  
`RefreshSession` : session rotative révocable.  
`PlatformRole` : droit Monarque Group séparé des droits tenant.

## Organization

`Organization` : tenant et frontière principale de données.  
`BusinessType` : classification extensible utilisée pour proposer une configuration initiale.  
`Establishment` : établissement opérationnel d'une organisation : siège, agence, boutique, bureau ou autre unité.  
`Membership` : relation User ↔ Organization avec rôle.  
`MembershipEstablishmentScope` : établissements sur lesquels un membre peut agir.  
`Invitation` : invitation membre avec expiration et usage unique.

## Plans, modules et entitlements

`ModuleDefinition` : module canonique du produit avec code stable, dépendances et état de disponibilité.  
`BusinessTypePreset` : modules proposés par défaut pour un type d'entreprise.  
`Plan` : offre commerciale versionnée.  
`PlanModule` : capacité incluse/limite par défaut d'un plan.  
`OrganizationSubscription` : plan courant d'un tenant et son cycle de validité.  
`OrganizationEntitlement` : override explicite accordant, limitant ou retirant une capacité.  
`OrganizationModuleActivation` : choix de configuration d'un module autorisé.  
`QuotaUsage` : consommation d'une limite mesurable.

### Règle de calcul

`effective capability = subscription plan + active override - suspension`.

Une capacité effective ne peut être utilisée que si le module est activé et si le membre possède la permission et le scope nécessaires.

## Party

`BusinessParty` : client, fournisseur ou les deux, propre à une organisation. Peut être lié à une organisation du réseau sans partager ses données privées.

## Catalog

`Item` : `PRODUCT | SERVICE`. Prix de référence, unité, SKU optionnel.  
`Warehouse` : dépôt rattaché à un établissement.  
`StockMovement` : écriture de stock durable.

## CRM

`Lead` et `Opportunity`. Une opportunity peut provenir d'une `NetworkInquiry` et conduire à un devis.

## Sales

`Quote` : `DRAFT | SENT | ACCEPTED | REJECTED | EXPIRED | CANCELLED`.  
`SalesOrder` : `DRAFT | CONFIRMED | FULFILLED | CANCELLED`.  
`Invoice` : `DRAFT | ISSUED | PARTIALLY_PAID | PAID | VOID`.  
`PaymentRecord` : constat d'encaissement ; ce n'est pas un processeur de paiement.

Les lignes sont snapshotées.

## Purchases

`SupplierRFQ` : demande de prix à un ou plusieurs fournisseurs.  
`PurchaseOrder` : commande fournisseur.  
`GoodsReceipt` : réception de produits et origine possible des mouvements de stock.

Une RFQ peut viser des fournisseurs locaux ou des organisations connectées au réseau.

## Expenses & Cash

`Expense` : dépense enregistrée.  
`CashAccount` : caisse logique rattachée à un établissement.  
`CashMovement` : mouvement append-only `IN | OUT`, éventuellement lié à un paiement, une dépense ou une correction documentée.

Le solde de caisse est dérivé des mouvements valides.

## Projects

`Project` : unité de suivi opérationnel légère.  
`ProjectTask` : tâche, responsable, échéance et statut.  
Les dépenses, documents et opportunités peuvent référencer un projet lorsque pertinent.

## Network

`OrganizationProfile` : projection publique opt-in.  
`ConnectionRequest` : demande B2B.  
`BusinessConnection` : relation acceptée.  
`NetworkInquiry` : demande commerciale d'une organisation à une autre, convertible en lead/opportunity.

## Messaging

`Conversation` : relation entre deux organisations autorisées.  
`Message` : message immuable, auteur utilisateur + organisation d'origine.

## Intelligence

`MetricSnapshot` : valeur calculée d'un KPI à un instant donné.  
`InsightRule` : règle déterministe d'analyse/alerte.  
`InsightAlert` : alerte créée par une règle.

Aucune donnée cross-tenant identifiable n'est exposée. Le benchmarking agrégé/anonymisé est hors MVP tant que gouvernance et critères d'anonymisation ne sont pas validés.

## Documents & Platform

`Document` : métadonnées métier.  
`MediaObject` : objet de stockage.  
`AuditEvent` : trace immuable des actions sensibles.  
`OutboxEvent` : événement durable d'intégration.
