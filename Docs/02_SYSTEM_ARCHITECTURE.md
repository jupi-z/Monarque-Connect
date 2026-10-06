# 02 — Architecture système

## Style

**Monolithe modulaire API-first**, propriétaire, sans ERPNext/Frappe.

```text
Clients futurs
(Web / Admin / Mobile / intégrations)
              |
          HTTPS REST
              |
      monarque-connect-api
              |
  +-----------+-----------+
  |                       |
PostgreSQL           Object Storage
```

## Architecture produit

Le backend matérialise quatre plans fonctionnels dans un seul déploiement modulaire :

- **Network** : identité publique économique et interactions B2B ;
- **Business OS** : opérations internes ;
- **Intelligence** : métriques, projections et alertes ;
- **Control Plane** : administration SaaS Monarque Group.

Ces plans sont séparés par frontières de modules, permissions et contrats, sans imposer des microservices.

## Frontières backend

### Core / Identity
- `auth`
- `users`
- `organizations`
- `business-types`
- `establishments`
- `memberships`

### Commercial entitlements
- `module-catalog`
- `plans`
- `entitlements`
- `quotas`

### Business OS
- `parties`
- `catalog`
- `crm`
- `quotes`
- `orders`
- `invoices`
- `payments`
- `purchases`
- `expenses`
- `cash`
- `inventory`
- `projects`
- `documents`
- `media`

### Network
- `network`
- `inquiries`
- `conversations`
- `messages`

### Intelligence / AI foundation
- `events`
- `outbox`
- `metrics`
- `insights`
- `alerts`
- `knowledge` (projection layer)
- `ai-policy`
- `ai-gateway` (future runtime boundary)
- `agents` (future runtime boundary)

### Platform / infrastructure
- `platform`
- `audit`

## Architecture AI-native

```text
HTTP/API
  ↓
Application / Domain
  ↓
PostgreSQL transaction
  ├─ état métier
  └─ OutboxEvent
        ↓
     Event Fabric
        ↓
  ┌─────┴──────────────┐
  │                    │
Metrics/Alerts     Knowledge Projections
  │                    │
  └────────┬───────────┘
           ↓
   Intelligence Engine
           ↓
      AI Gateway
           ↓
    Model Providers
           ↓
    Agent Proposals
           ↓
 Commands/API du Core
```

Le chemin retour vers le Core passe uniquement par des commands/tools autorisés. Un modèle n'écrit jamais directement dans les tables métier.

### Event Fabric
PostgreSQL transactional outbox + workers idempotents au MVP. Kafka/RabbitMQ restent différés jusqu'à besoin mesuré.

### Knowledge Layer
Projection gouvernée et reconstruisible, jamais source de vérité.

### AI Gateway
Boundary provider-neutral pour toute future inference externe ou locale.

## Couches

- **HTTP** : controllers, DTO, guards, mapping.
- **Application** : use-cases et orchestration.
- **Domain** : invariants, transitions et politiques.
- **Infrastructure** : Prisma/PostgreSQL, S3, crypto, email, logs.

## Pipeline d'autorisation

Avant une action tenant :

`authenticated → tenant active → membership active → entitlement allowed → module active → role permission → establishment scope → resource ownership/policy`

Le contrôle est centralisé dans des policies/guards réutilisables. Aucun contrôleur ne recompose cette logique à la main.

## Règles

- contrôleur sans logique métier ;
- dépendances inter-modules via services publics/ports ;
- transaction pour toute opération multi-écriture cohérente ;
- aucune autorisation fondée uniquement sur le type d'entreprise ou le frontend ;
- business types = presets ;
- plans = plafond commercial ;
- entitlements = capacités effectives ;
- activations = configuration tenant ;
- permissions/scopes = autorisation utilisateur ;
- aucune extraction microservice sans raison mesurée ;
- aucun SDK fournisseur IA dans les modules métier ;
- tout événement critique est atomique avec la transaction qui l'a causé ;
- tout consumer d'événement est idempotent ;
- toute future action agentique repasse par les mêmes policies/commands que l'utilisateur.

## Clients

Chaque client est un dépôt distinct. Le backend ignore React, Next.js, mobile, CSS, navigation ou structure d'écran. Les clients utilisent `GET /organizations/{organizationId}/capabilities` pour construire leur navigation sans devenir source de vérité.
