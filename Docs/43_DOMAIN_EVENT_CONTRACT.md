# 43 — Contrat des événements de domaine

## Objectif

Le contrat événementiel constitue la mémoire structurée du système et le point d'ancrage futur de Monarque Intelligence.

## Envelope canonique

Chaque événement possède :

- `eventId` UUID ;
- `eventType` stable, ex. `organization.created` ;
- `eventVersion` entier >= 1 ;
- `occurredAt` UTC ;
- `recordedAt` UTC ;
- `organizationId?` ;
- `establishmentId?` ;
- `actor.type` = `USER | SYSTEM | AGENT | PLATFORM` ;
- `actor.id?` ;
- `aggregate.type` ;
- `aggregate.id` ;
- `correlationId` ;
- `causationId?` ;
- `requestId?` ;
- `dataClassification` ;
- `purpose` ;
- `payload` versionné.

## Règles

- un événement décrit un fait passé, jamais une intention ;
- noms au passé logique : `invoice.issued`, pas `issue.invoice` ;
- payload minimal suffisant ; pas de dump ORM ;
- aucun secret/token/password ;
- les données très sensibles sont exclues ou réduites à des références ;
- un événement publié est immuable ;
- une correction produit un nouvel événement ;
- une nouvelle forme incompatible incrémente `eventVersion`.

## Transactional outbox

Toute écriture métier qui doit produire un événement critique :
1. modifie l'état métier ;
2. ajoute l'OutboxEvent ;
3. commit dans la même transaction PostgreSQL.

Un worker publie/consomme ensuite l'événement de manière retry-safe.

## Livraison

Garantie cible MVP : **at-least-once**.

Tout consommateur doit être idempotent. Aucun composant ne suppose exactly-once.

## Ordering

- ordre global non garanti ;
- ordre par aggregate préservé autant que possible via `aggregateVersion` futur ou séquence locale lorsque nécessaire ;
- consumers doivent tolérer retry et retard.

## Catalogue initial

### Identity/Tenancy
- `user.registered`
- `user.suspended`
- `organization.created`
- `organization.suspended`
- `establishment.created`
- `membership.created`
- `membership.role_changed`
- `membership.scope_changed`

### Entitlements
- `subscription.changed`
- `entitlement.changed`
- `module.activation_changed`
- `quota.exceeded`

### Business
- `lead.created`
- `opportunity.created`
- `quote.sent`
- `quote.accepted`
- `order.confirmed`
- `invoice.issued`
- `payment.recorded`
- `supplier_rfq.sent`
- `purchase_order.confirmed`
- `goods_receipt.confirmed`
- `stock.moved`
- `cash.moved`
- `expense.recorded`
- `project.completed`

### Network/Documents
- `network.inquiry_received`
- `network.connection_accepted`
- `document.expiring`
- `organization.verification_changed`

## Consumption

Les événements alimentent :
- audit technique/métier lorsque approprié ;
- métriques ;
- notifications futures ;
- projections Intelligence ;
- Knowledge Layer ;
- intégrations futures.

AuditEvent et DomainEvent ne sont pas interchangeables : l'audit répond à “qui a fait quoi”, l'événement métier à “quel fait métier s'est produit”.
