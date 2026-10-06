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

### Intelligence
- `metrics`
- `insights`
- `alerts`

### Platform / infrastructure
- `platform`
- `audit`
- `outbox`

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
- aucune extraction microservice sans raison mesurée.

## Clients

Chaque client est un dépôt distinct. Le backend ignore React, Next.js, mobile, CSS, navigation ou structure d'écran. Les clients utilisent `GET /organizations/{organizationId}/capabilities` pour construire leur navigation sans devenir source de vérité.
