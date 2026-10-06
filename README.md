# Monarque Connect

**Statut : FROZEN SPECIFICATION BASELINE v1.1**  
**Propriétaire : Monarque Group S.A.S.**  
**Maîtrise d'œuvre : LTEX**  
**Backend owner : @jupi-z**  
**Collaborateur : @Gabby344**

Monarque Connect est un **Business Operating Network** propriétaire : un système d'exploitation métier pour entreprises, relié à un réseau B2B, à une couche d'intelligence opérationnelle et à un control plane SaaS.

## Architecture produit

Monarque Connect repose sur quatre piliers complémentaires :

1. **Monarque Network** — visibilité, découverte, relations B2B, demandes et échanges ;
2. **Monarque Business OS** — CRM, ventes, achats, stock, caisse, projets, documents et opérations ;
3. **Monarque Intelligence** — KPI, alertes et insights opérationnels, sans dépendance à une IA pour le MVP ;
4. **Monarque Control Plane** — organisations, plans, modules, entitlements, quotas, support et audit plateforme.

Le projet est **100 % API-first** et ne dépend d'aucun ERP tiers. ERPNext et Frappe ne font pas partie de l'architecture.

## Modèle d'accès

La configuration fonctionnelle suit :

`Organization → Business Type Template → Plan → Effective Entitlements → Module Activation → Establishments → Membership → Role/Permission → Establishment Scope`

Le type d'entreprise fournit des valeurs par défaut, jamais une autorisation de sécurité. Le plan définit le plafond commercial ; les entitlements déterminent les capacités réellement autorisées ; le RBAC et le scope d'établissement déterminent ensuite qui peut agir et où.

## Principe d'architecture

Le backend constitue un produit autonome : il doit pouvoir être installé, démarré, testé, administré et exploité sans aucune interface graphique. Aucun use-case métier critique ne dépend d'un client Web, mobile ou desktop.

Les futurs clients sont des projets distincts et remplaçables. Ils consomment le contrat OpenAPI et découvrent dynamiquement les capacités effectives du tenant.

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
2. modèle produit / entitlements ;
3. contrat OpenAPI ;
4. modèle de données ;
5. matrice d'autorisation ;
6. ADR ;
7. conventions d'implémentation.

Voir `Docs/00_README.md`.
