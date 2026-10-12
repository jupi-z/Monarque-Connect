# 60 — Spécification d'exécution Phase 3 — Référentiels

## Objectif

La Phase 3 livre les référentiels métier tenant-scoped dont les phases CRM, Sales,
Purchases et Operations dépendront :

- business parties (clients, fournisseurs ou les deux) ;
- items du catalogue métier (produits et services) ;
- warehouses rattachés à un établissement.

La phase ne livre pas encore les workflows commerciaux, les mouvements de stock,
la découverte réseau ni les projections publiques. Elle fournit des agrégats
stables, auditables et réutilisables par ces phases futures.

## Invariants non négociables

1. Toute ressource porte `organization_id` et n'est lisible ou modifiable que
   dans le tenant de la requête.
2. Toute ressource localisée porte `establishment_id` et vérifie le scope actif
   du membership avant lecture, écriture, recherche ou agrégation.
3. Toute requête suit l'ordre serveur :
   `tenant active → membership active → entitlement → module active → permission → establishment scope`.
4. Le type d'entreprise, le rôle du membre et le client HTTP ne constituent
   jamais une preuve d'entitlement.
5. Les modules contrôlés sont : `CRM` pour les business parties, `CATALOG`
   pour les items et `INVENTORY` pour les warehouses.
6. Une capacité absente, suspendue, désactivée ou non autorisée produit un refus
   serveur contrôlé ; aucune route référentiel ne devient implicitement publique.
7. Les désactivations sont non destructives. Une ressource référencée par un
   futur document transactionnel ne doit pas être supprimée physiquement.
8. Chaque mutation significative écrit son audit et son événement Outbox dans la
   même transaction Prisma que l'état métier.
9. Les événements utilisent l'envelope canonique, les IDs de contexte de
   requête/corrélation et une classification `CONFIDENTIAL`.
10. Les montants décimaux sont sérialisés comme chaînes dans l'API ; les UUID
    restent opaques pour les clients.

## Modèle de données

### BusinessParty

Champs minimaux : `id`, `organization_id`, `type`, `display_name`, `email?`,
`phone?`, `tax_id?`, `notes?`, `active`, `created_at`, `updated_at`.

`type` est une valeur extensible de référence : `CUSTOMER`, `SUPPLIER` ou
`BOTH`. La Phase 3 ne permet pas encore de renseigner ou d'exploiter
`linked_organization_id` : le lien avec une organisation du réseau appartient à
la Phase 4 et ne doit pas contourner les contrôles Network.

Une party désactivée reste consultable par une référence interne autorisée mais
n'est pas proposée comme nouvelle cible d'un workflow futur. Les recherches
opérationnelles excluent les parties inactives par défaut.

### Item

Champs minimaux : `id`, `organization_id`, `type`, `sku?`, `name`,
`description?`, `unit`, `reference_price`, `currency`, `track_inventory`,
`active`, `created_at`, `updated_at`.

`type` vaut `PRODUCT` ou `SERVICE`. Le `sku`, lorsqu'il est fourni, est unique
dans l'organisation. Le prix de référence n'est pas une facture ni un prix
historique : les documents transactionnels futurs devront en faire un snapshot.
`track_inventory` ne crée aucun mouvement de stock dans cette phase.

### Warehouse

Champs minimaux : `id`, `organization_id`, `establishment_id`, `code`, `name`,
`active`, `created_at`, `updated_at`.

`code` est unique dans l'organisation. L'establishment parent doit appartenir
au même tenant et être actif pour une création ou une modification. Un warehouse
ne peut jamais être rattaché à un établissement hors du scope du membre.

## API Phase 3

Les routes sont sous `/api/v1/organizations/{organizationId}` et exigent
`AuthGuard`.

### Business parties

- `GET /parties` : liste paginée des parties accessibles, filtres `type`,
  `active` et recherche textuelle ;
- `POST /parties` : crée une party ; permission `parties:write` ;
- `GET /parties/{partyId}` : lit une party du tenant ;
- `PATCH /parties/{partyId}` : modifie les champs autorisés ; permission
  `parties:write` ;
- `POST /parties/{partyId}/deactivate` et `/reactivate` : transitions
  idempotentes et auditées ; permission `parties:write`.

Les parties sont organization-wide dans cette phase. Elles ne reçoivent donc
pas artificiellement un `establishment_id`; les workflows qui les utilisent
imposeront leur propre scope établissement.

### Items

- `GET /items` : liste paginée avec filtres `type`, `active`, `sku` et recherche ;
- `POST /items` : crée un item ; permission `catalog:write` ;
- `GET /items/{itemId}` : lit un item du tenant ;
- `PATCH /items/{itemId}` : modifie les champs de référentiel ; permission
  `catalog:write` ;
- `POST /items/{itemId}/deactivate` et `/reactivate` : transitions
  idempotentes et auditées.

### Warehouses

- `GET /establishments/{establishmentId}/warehouses` : liste limitée au scope ;
- `POST /establishments/{establishmentId}/warehouses` : crée un warehouse ;
  permission `inventory:write` ;
- `GET /establishments/{establishmentId}/warehouses/{warehouseId}` : lit un
  warehouse accessible ;
- `PATCH /establishments/{establishmentId}/warehouses/{warehouseId}` : modifie
  le nom ou le code selon les règles d'unicité ; permission `inventory:write` ;
- `POST /establishments/{establishmentId}/warehouses/{warehouseId}/deactivate`
  et `/reactivate` : transitions non destructives, idempotentes et auditées.

Les réponses de liste utilisent le contrat de pagination existant. Une ressource
hors tenant ou hors scope ne doit pas être distinguée par son statut HTTP ou par
un temps de réponse révélateur.

## Autorisation

L'extension d'autorisation doit déclarer explicitement les permissions
`parties:read`, `parties:write`, `catalog:read`, `catalog:write`, `inventory:read`
et `inventory:write`, puis les attribuer à la matrice de rôles existante :

- parties : lecture `OWNER`, `ADMIN`, `SALES`, `FINANCE`, `OPERATIONS`, `VIEWER` ;
  écriture `OWNER`, `ADMIN`, `SALES`, `OPERATIONS` ;
- catalogue : mêmes règles que la matrice Catalogue ;
- warehouses : lecture `OWNER`, `ADMIN`, `SALES`, `FINANCE`, `OPERATIONS`,
  `VIEWER` ; écriture `OWNER`, `ADMIN`, `OPERATIONS`.

Chaque service réutilise `AuthorizationService`,
`EffectiveEntitlementsService` et `PrismaOutboxWriter`. Il ne crée pas de
second mécanisme d'autorisation et ne fait pas confiance à `organizationId`,
`establishmentId` ou `moduleCode` fournis par le client.

## Audit et événements

Les mutations publient au minimum :

| Agrégat | Événements |
|---|---|
| `BusinessParty` | `business_party.created`, `business_party.updated`, `business_party.status_changed` |
| `Item` | `catalog.item.created`, `catalog.item.updated`, `catalog.item.status_changed` |
| `Warehouse` | `warehouse.created`, `warehouse.updated`, `warehouse.status_changed` |

Les payloads ne contiennent pas de secrets, respectent la classification et
incluent l'identifiant d'agrégat, le tenant, l'auteur et les champs de changement
nécessaires à l'audit. Les opérations idempotentes sans changement ne créent pas
un nouvel audit ni un nouvel événement.

## Concurrence et base de données

- contraintes uniques PostgreSQL sur le SKU non nul par organisation et le code
  warehouse par organisation ;
- vérification transactionnelle de l'appartenance organization/establishment ;
- transitions de statut sûres sous concurrence ;
- migration additive et preuve d'upgrade depuis la dernière baseline Phase 2 ;
- seed de référence limité aux enums/valeurs contractuelles nécessaires, sans
  données métier fictives dans les tenants.

## Hors périmètre explicite

- `StockMovement`, inventaire disponible et valorisation ;
- `Lead`, `Opportunity`, profil public et réseau ;
- prix par client, taxes, devis, commandes, factures et achats ;
- import massif, recherche full-text, fichiers ou IA ;
- hard delete ou restauration d'un historique transactionnel.

## Gate de sortie

La Phase 3 ne sera clôturée qu'après : migration base vide et upgrade Phase 2,
tests PostgreSQL d'isolation/concurrence, tests HTTP des refus d'entitlement,
d'activation, de rôle et de scope, audit/Outbox atomiques, OpenAPI et contrats
valides, CI verte, PR revue et documentation de preuve synchronisée.
