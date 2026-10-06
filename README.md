# Monarque Connect

**Statut : FROZEN SPECIFICATION BASELINE v1.0**  
**Propriétaire : Monarque Group S.A.S.**  
**Maîtrise d'œuvre : LTEX**  
**Backend owner : @jupi-z**  
**Collaborateur : @Gabby344**

Monarque Connect est un **Business Operating Network** : un socle de gestion opérationnelle pour entreprises, relié à un réseau B2B permettant aux organisations de se découvrir, se connecter et collaborer.

## Principe d'architecture

Le projet est **100 % API-first**.

Le backend constitue un produit autonome : il doit pouvoir être installé, démarré, testé, administré et exploité sans aucune interface graphique. Aucun use-case métier critique ne dépend d'un client Web, mobile ou desktop.

Les futurs clients seront des projets distincts et remplaçables. Ils ne contiendront aucune logique d'autorisation ou de cohérence indispensable.

## Stack figée

- Node.js 24
- TypeScript strict
- NestJS 12
- PostgreSQL 17
- Prisma 7
- REST JSON sous `/api/v1`
- OpenAPI 3.1 contract-first
- stockage objet S3-compatible
- Argon2id
- JWT d'accès + refresh token opaque rotatif
- Vitest + Supertest
- Docker
- GitHub Actions

## Règle absolue

Le code ne redéfinit pas le produit. En cas d'ambiguïté, la hiérarchie est :

1. invariants métier et sécurité ;
2. contrat OpenAPI ;
3. modèle de données ;
4. matrice d'autorisation ;
5. ADR ;
6. conventions d'implémentation.

Le backend est la source de vérité et doit fonctionner sans aucun client officiel.

Voir `Docs/00_README.md`.
