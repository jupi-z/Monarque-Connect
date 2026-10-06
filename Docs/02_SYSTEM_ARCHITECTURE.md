# 02 — Architecture système

## Style
**Monolithe modulaire**.

```text
Clients futurs
(Web / Admin / Mobile / intégrations)
              |
          HTTPS REST
              |
      monarque-connect-api
              |
    +---------+---------+
    |                   |
PostgreSQL         Object Storage
```

## Frontières backend
- `auth`
- `users`
- `organizations`
- `memberships`
- `parties`
- `catalog`
- `crm`
- `quotes`
- `orders`
- `invoices`
- `payments`
- `expenses`
- `inventory`
- `network`
- `conversations`
- `messages`
- `documents`
- `media`
- `audit`
- `platform`
- `outbox`

## Couches
- **HTTP** : controllers, DTO, guards, mapping.
- **Application** : use-cases.
- **Domain** : invariants et transitions.
- **Infrastructure** : Prisma/PostgreSQL, S3, crypto, email, logs.

## Règles
- contrôleur sans logique métier ;
- dépendances inter-modules via ports/use-cases publics ;
- aucune requête directe aux tables internes d'un autre module depuis un controller ;
- transaction pour toute opération multi-écriture cohérente ;
- aucune extraction microservice sans charge/SLA/équipe/isolation justifiant réellement l'extraction.

## Clients
Chaque client est un dépôt distinct. Le backend ignore React, Next.js, mobile, CSS, navigation ou structure d'écran.
