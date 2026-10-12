# 21 — Roadmap d'exécution v1.2

La roadmap est ordonnée pour éviter de construire les modules métier avant les mécanismes qui déterminent **qui peut y accéder, dans quel tenant, dans quel établissement et sous quel plan**.

## Phase 0 — Fondation
Repo, Node/TS/Nest, PostgreSQL, Prisma, Docker, config, health, OpenAPI validation, CI.

## Phase 0.5 — AI-native foundation

Spécification d'exécution : `50_EVENT_FABRIC_IMPLEMENTATION_SPEC.md`.

Avant la première verticale métier :
- Domain Event envelope ;
- transactional outbox ;
- correlation/causation/request IDs ;
- actor types ;
- data classification ;
- provenance metadata ;
- worker/consumer idempotent minimal ;
- aucune intégration fournisseur IA.

**Gate :** un use-case de fondation prouve transaction + outbox atomique + replay idempotent.

## Phase 1 — Identity & tenancy
Auth, users, organizations, business types, establishments, memberships, invitations, RBAC, establishment scopes, tenant isolation.

Chaque mutation significative de cette phase émet les événements définis dans `43_DOMAIN_EVENT_CONTRACT.md`.

**Gate :** deux tenants + deux établissements + scopes testés sans fuite, et événements identity/tenancy prouvés atomiques.

## Phase 2 — Product entitlements
Module catalog, business type presets, plans versionnés, subscriptions, organization entitlements, module activations, quotas, capabilities endpoint.

**Gate :** changement de plan/override prend effet côté serveur sans modification du client.

**État :** terminée et clôturée à 100 %. Le périmètre comprend désormais les overrides organisationnels, presets métier persistés, quotas appliqués aux ressources et invariants PostgreSQL. Voir `59_PHASE_2_CLOSURE_EVIDENCE.md` pour les preuves de migration, concurrence, isolation, audit, E2E HTTP et CI.

## Phase 3 — Référentiels
Business parties, catalog, warehouses.

**État :** terminée et clôturée à 100 %. Les preuves reproductibles sont dans
`62_PHASE_3_CLOSURE_EVIDENCE.md` ; les contrôles d'entitlement, activation,
permission et scope sont appliqués côté serveur. Les workflows CRM, ventes,
achats et mouvements de stock restent dans les phases suivantes.

## Phase 4 — CRM + Network entry
Leads, opportunities, organization public profiles, verification/trust, discovery, connections, NetworkInquiry → CRM.

## Phase 5 — Sales
Quotes → Sales Orders → Invoices → PaymentRecords.

## Phase 6 — Purchases
Supplier RFQ → Purchase Order → Goods Receipt.

## Phase 7 — Operations
Inventory, expenses, cash accounts/movements.

## Phase 8 — Projects & documents
Projects, tasks, document linking, media.

## Phase 9 — Messaging B2B
Conversations, messages, network policies, anti-abuse baseline.

## Phase 10 — Intelligence

### 10A — déterministe
KPI projections, metric snapshots, deterministic insight rules, alerts, dashboards API.

### 10B — probabiliste gouverné
Premières features IA ciblées seulement si les gates de `48_AI_SECURITY_AND_EVALUATION.md` sont satisfaites :
- AI Gateway ;
- model registry ;
- tenant AI policy ;
- Knowledge Layer minimale ;
- feature d'assistance évaluée.

Pas d'agent généraliste au premier lancement.

## Phase 11 — Control Plane
Platform tenant administration, plans, entitlements, quotas, tenant status, support-safe operations, audit.

## Phase 11.5 — Agent readiness

Contrats de tool/action, classes A0-A4, confirmations, délégations et audit. Aucun agent high-impact autonome.

## Phase 12 — Hardening/release
Security, concurrency, migration, entitlement downgrade tests, performance, backup/restore, tenant export/portability, staging, release.

## Ordre parallèle frontend

Le frontend Business peut démarrer à partir :
- Phase 1 : shell auth/organization/establishments ;
- Phase 2 : navigation dynamique basée sur capabilities ;
- puis chaque verticale dès que son contrat OpenAPI est gelé.

## Règles

- une phase ne modifie pas silencieusement les invariants des phases précédentes ;
- aucune feature métier n'introduit sa propre logique d'entitlement locale ;
- tout nouveau module reçoit un code catalogue avant ses endpoints ;
- tout nouveau domaine déclare rôle, establishment scope, quota éventuel, événements et audit avant implémentation.
