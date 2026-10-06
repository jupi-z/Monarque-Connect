# 21 — Roadmap d'exécution v1.1

La roadmap est ordonnée pour éviter de construire les modules métier avant les mécanismes qui déterminent **qui peut y accéder, dans quel tenant, dans quel établissement et sous quel plan**.

## Phase 0 — Fondation
Repo, Node/TS/Nest, PostgreSQL, Prisma, Docker, config, health, OpenAPI validation, CI.

## Phase 1 — Identity & tenancy
Auth, users, organizations, business types, establishments, memberships, invitations, RBAC, establishment scopes, tenant isolation.

**Gate :** deux tenants + deux établissements + scopes testés sans fuite.

## Phase 2 — Product entitlements
Module catalog, business type presets, plans versionnés, subscriptions, organization entitlements, module activations, quotas, capabilities endpoint.

**Gate :** changement de plan/override prend effet côté serveur sans modification du client.

## Phase 3 — Référentiels
Business parties, catalog, warehouses.

## Phase 4 — CRM + Network entry
Leads, opportunities, organization public profiles, discovery, connections, NetworkInquiry → CRM.

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
KPI projections, metric snapshots, deterministic insight rules, alerts, dashboards API.

## Phase 11 — Control Plane
Platform tenant administration, plans, entitlements, quotas, tenant status, support-safe operations, audit.

## Phase 12 — Hardening/release
Security, concurrency, migration, entitlement downgrade tests, performance, backup/restore, staging, release.

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
