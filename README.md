# Monarque Connect

Monarque Connect est un **Business Operating Network** conçu pour aider les entreprises à structurer leurs opérations, développer leurs relations B2B et exploiter progressivement leurs données pour mieux décider.

Le produit combine dans un même écosystème un **réseau économique entre entreprises**, un **Business OS opérationnel**, une **couche d’intelligence** et un **Control Plane SaaS**. Le backend est autonome et **100 % API-first** : les interfaces Web, mobile ou administrateur sont des clients séparés et remplaçables.

> **État du projet**
>
> La baseline fonctionnelle et architecturale **v1.2 — AI-Native Foundation** est figée.  
> La fondation technique du backend est validée et **Phase 0.5 — Event Fabric** est terminée sur `main`.  
> **Phase 1 — Identity & Tenancy** et **Phase 2 — Product Entitlements** sont terminées et vérifiées sur `main`. Le prochain jalon est **Phase 3 — Référentiels**.
>
> Les modules métier décrits ci-dessous représentent la **cible du MVP**. Ils ne sont pas tous encore implémentés.

## Pourquoi Monarque Connect ?

Beaucoup d’entreprises utilisent des outils isolés pour gérer leurs prospects, ventes, achats, stock, dépenses, documents et communications avec leurs partenaires. Les données restent dispersées, les processus sont difficiles à suivre et les relations B2B restent largement déconnectées du système de gestion interne.

Monarque Connect vise à créer une continuité :

~~~text
Découverte B2B
    ↓
Demande commerciale
    ↓
CRM / Opportunité
    ↓
Devis → Commande → Facture → Encaissement
    ↓
Historique opérationnel structuré
    ↓
KPI → Alertes → Prévisions → Recommandations
~~~

La même logique s’applique aux achats :

~~~text
Besoin
  ↓
RFQ fournisseur
  ↓
Commande fournisseur
  ↓
Réception
  ↓
Stock
  ↓
Données exploitables par l’entreprise
~~~

## Les quatre piliers

### 1. Monarque Network

La couche réseau permet aux entreprises de devenir visibles et d’interagir entre elles.

Fonctions prévues :
- profil public d’entreprise ;
- vérification et signaux de confiance publiables ;
- catalogue public de produits et services ;
- découverte d’entreprises ;
- connexions B2B ;
- demandes commerciales ;
- sourcing et RFQ vers des partenaires ;
- messagerie inter-entreprises.

Une interaction réseau peut alimenter directement le CRM et devenir une véritable opportunité commerciale.

### 2. Monarque Business OS

Le Business OS couvre les opérations quotidiennes de l’entreprise.

Périmètre MVP :
- organisations et établissements ;
- utilisateurs, rôles et permissions ;
- clients et fournisseurs ;
- catalogue produits/services ;
- CRM ;
- devis et commandes clients ;
- factures et encaissements constatés ;
- achats et demandes de prix ;
- stock simple ;
- dépenses et caisse ;
- projets légers ;
- documents et pièces métier.

Monarque Connect n’essaie pas de reproduire tout un ERP généraliste dès le départ. Les domaines lourds comme la comptabilité statutaire complète, la paie, le MRP ou la fiscalité automatisée restent hors MVP.

### 3. Monarque Intelligence

Monarque Intelligence transforme les données structurées du système en information exploitable.

La progression cible est :

~~~text
Facts
  → Metrics
  → Rules
  → Predictions
  → Recommendations
  → Agent Proposals
  → Authorized Actions
~~~

Le système commence par des KPI et alertes déterministes, puis pourra introduire progressivement des fonctions probabilistes : prévisions, résumés, détection d’anomalies, recommandations ou assistance conversationnelle.

L’architecture est **AI-native mais pas AI-dependent** : un modèle ne devient jamais la source de vérité d’un paiement, d’un stock, d’une facture, d’une permission ou d’un autre état transactionnel.

### 4. Monarque Control Plane

Le Control Plane permet d’exploiter Monarque Connect comme plateforme SaaS.

Il gère notamment :
- tenants ;
- types d’entreprise ;
- plans ;
- modules ;
- entitlements ;
- quotas ;
- statut et suspension d’une organisation ;
- vérification des entreprises ;
- opérations de support ;
- audit plateforme.

Les droits plateforme sont séparés des droits internes aux entreprises clientes.

## Entreprises ciblées

Monarque Connect est conçu pour rester générique au niveau du Core tout en adaptant l’expérience et les modules proposés au profil de l’entreprise.

Les premiers profils prévus sont :
- **prestataires de services** ;
- **commerce et distribution** ;
- **fournisseurs miniers / B2B** ;
- **petite industrie** ;
- **autres entreprises** via une configuration générique.

Le type d’entreprise sert de **preset initial**, pas de règle rigide. Une organisation peut ensuite activer les capacités auxquelles son plan lui donne droit.

Les entreprises multi-agences utilisent le même modèle grâce aux **établissements** et aux scopes d’accès associés.

## Modèle fonctionnel

La disponibilité d’une fonctionnalité suit plusieurs couches distinctes :

~~~text
Organization
  → Business Type Preset
  → Plan
  → Effective Entitlements
  → Module Activation
  → Establishments
  → Membership
  → Role / Permission
  → Establishment Scope
~~~

Cette séparation évite de créer une variante différente de Monarque Connect pour chaque secteur ou chaque offre commerciale.

## Architecture générale

Monarque Connect utilise un **monolithe modulaire API-first**.

~~~text
Clients
Web / Admin / Mobile / Integrations
                 │
                 ▼
            REST / HTTPS
                 │
                 ▼
        Monarque Connect API
          NestJS / TypeScript
                 │
        ┌────────┴────────┐
        ▼                 ▼
   PostgreSQL       Object Storage
        │
        ▼
 Transactional Outbox
        │
        ▼
      Event Fabric
        │
   ┌────┴───────────────┐
   ▼                    ▼
Metrics / Alerts   Knowledge Projections
   └────────┬───────────┘
            ▼
    Intelligence Engine
            ▼
        AI Gateway
            ▼
     Model Providers
            ▼
     Agent Proposals
            ▼
 Authorized Core Commands
~~~

Le **Core déterministe** reste souverain. Toute action future provenant d’une IA ou d’un agent doit repasser par les mêmes commandes, permissions, entitlements et invariants que les actions humaines.

## API-first

Le backend constitue un produit autonome.

Il doit pouvoir être :
- installé ;
- lancé ;
- testé ;
- administré ;
- intégré ;

sans dépendre d’une interface graphique officielle.

Les clients consomment l’API sous /api/v1 et utilisent le contrat OpenAPI comme référence. Ils ne doivent jamais accéder directement à PostgreSQL ou au stockage objet.

## AI-Native Foundation

L’architecture prépare l’intelligence dès les couches basses :

~~~text
Deterministic Core
      ↓
Event Fabric
      ↓
Knowledge Layer
      ↓
Intelligence Engine
      ↓
Agent Runtime
~~~

La fondation prévoit notamment :
- Domain Events versionnés ;
- transactional outbox ;
- provenance des données ;
- classification de sensibilité ;
- correlation / causation IDs ;
- consumers idempotents ;
- AI Gateway indépendant des fournisseurs ;
- politiques tenant pour l’usage futur de l’IA ;
- confirmation humaine pour les actions à fort impact.

Aucun fournisseur IA, vector database ou agent généraliste n’est nécessaire pour construire le Core.

## Stack backend

| Domaine | Technologie |
|---|---|
| Runtime | Node.js 24 |
| Langage | TypeScript strict |
| Framework | NestJS 12 |
| Base de données | PostgreSQL 17 |
| ORM | Prisma 7 |
| API | REST JSON / OpenAPI 3.1 |
| Auth cible | Argon2id + JWT asymétrique + refresh opaque rotatif |
| Stockage cible | S3-compatible |
| Tests | Vitest + Supertest |
| Conteneurs | Docker |
| CI | GitHub Actions |

Monarque Connect ne repose ni sur ERPNext ni sur Frappe.

## État d’implémentation

### Déjà en place

- structure NestJS ;
- configuration runtime validée au démarrage ;
- PostgreSQL 17 en environnement de développement et CI ;
- Prisma initialisé ;
- endpoints /api/v1/health/live et /api/v1/health/ready ;
- readiness réellement reliée à PostgreSQL ;
- CORS en allowlist ;
- contrat OpenAPI de surface ;
- contrats machine-readable pour Domain Events et propositions d’actions agentiques ;
- validation lint / typecheck / Prisma / OpenAPI / contrats / tests / build en CI ;
- documentation normative v1.2.
- enveloppe Domain Event versionnée et validée ;
- migrations PostgreSQL de l'outbox et des receipts ;
- preuve transactionnelle fact + event ;
- dispatcher versionné, consumer idempotent et worker avec retry/lease.

### Prochaines étapes

1. **Phase 1 — Identity & Tenancy — terminée**
   Auth, utilisateurs, organisations, types d’entreprise, établissements, memberships, invitations, RBAC et isolation multi-tenant.

2. **Phase 2 — Product Entitlements — terminée**
   Plans, modules, subscriptions, entitlements, quotas, activations et endpoint capabilities. Les preuves de clôture sont dans `Docs/59_PHASE_2_CLOSURE_EVIDENCE.md`.

3. **Phase 3 — Référentiels**
   Business parties, catalogue métier et warehouses.

Les verticales CRM, ventes, achats, opérations, réseau, messaging et intelligence viennent ensuite selon la roadmap normative.

## Démarrage local

### Prérequis

- Node.js 24 ;
- npm ;
- Docker avec Docker Compose.

### Installation

~~~bash
npm ci
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d
npm run prisma:generate
npm run prisma:deploy
npm run start:dev
~~~

Le backend écoute par défaut sur :

~~~text
http://localhost:3000/api/v1
~~~

Vérifications :

~~~bash
curl http://localhost:3000/api/v1/health/live
curl http://localhost:3000/api/v1/health/ready
~~~

### Validation du projet

~~~bash
npm run lint
npm run typecheck
npm run prisma:validate
npm run prisma:generate
npm run prisma:deploy
npm run openapi:validate
npm run contracts:validate
npm test
npm run build
~~~

## Structure du dépôt

~~~text
.
├── Docs/          Documentation normative
├── contracts/     Contrats machine-readable
├── openapi/       Contrat HTTP OpenAPI
├── prisma/        Schéma et migrations Prisma
├── scripts/       Outils de validation
├── src/           Backend NestJS
├── tests/         Tests automatisés
└── .github/       CI et gouvernance GitHub
~~~

## Documentation

La documentation complète se trouve dans [Docs/](Docs/).

Quelques points d’entrée :

- [Index documentaire](Docs/00_README.md)
- [Périmètre et invariants](Docs/01_PRODUCT_SCOPE_AND_INVARIANTS.md)
- [Architecture système](Docs/02_SYSTEM_ARCHITECTURE.md)
- [Modèle produit](Docs/32_PRODUCT_MODEL.md)
- [Types d’entreprise, plans et entitlements](Docs/33_BUSINESS_TYPES_PLANS_ENTITLEMENTS.md)
- [Roadmap d’exécution](Docs/21_EXECUTION_ROADMAP.md)
- [AI-Native Foundation](Docs/42_AI_NATIVE_FOUNDATION.md)
- [Contrat des Domain Events](Docs/43_DOMAIN_EVENT_CONTRACT.md)
- [Spécification Event Fabric](Docs/50_EVENT_FABRIC_IMPLEMENTATION_SPEC.md)

Pour toute décision normative, les documents de [Docs/](Docs/) font autorité sur ce README de présentation.

## Contribution

Les règles de contribution et de gouvernance du dépôt sont décrites dans [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

Monarque Connect est un projet propriétaire. Les conditions applicables au code et aux contributions sont définies dans [LICENSE](LICENSE) et dans les accords applicables aux contributeurs.
