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

**État :** terminée et clôturée à 100 %. Le périmètre livré et les preuves
consolidées sont décrits dans `65_PHASE_4_STATUS.md` et
`70_PHASE_4_CLOSURE_EVIDENCE.md`, avec le suivi GitHub dans l'issue #49.
La Phase 4 ne doit pas être rouverte ; toute évolution ultérieure doit faire
l'objet d'une nouvelle spécification ou d'un correctif explicitement tracé.

## Phase 5 — Sales
Quotes → Sales Orders → Invoices → PaymentRecords.

**État :** terminée et clôturée techniquement à 100 % le 13/10/2026. La
spécification normative est `71_PHASE5_SALES_EXECUTION_SPEC.md`, le statut est
`72_PHASE_5_STATUS.md`, le plan est
`superpowers/plans/2026-10-13-phase-5-sales-plan.md` et la preuve consolidée
est `73_PHASE_5_CLOSURE_EVIDENCE.md`. Les PR #67 à #73 ont livré et validé les
Quotes, Sales Orders, Invoices, PaymentRecords, les conversions idempotentes,
les contrôles d'isolation et les preuves de migrations. Le commit de clôture
de la livraison finale est
`921d329a7c19e64b5f054a49c1d9c6fee7b8d2ba`; les CI PR #210 et post-merge
Backend CI #211 sont vertes. Le suivi GitHub est l'issue #63 et la clôture
documentaire est intégrée sur `main@623fa9e79947e4608f7d2c66d841d053b22684e2`,
avec la CI post-merge Backend #213 verte.

## Phase 6 — Purchases
Supplier RFQ → Purchase Order → Goods Receipt.

**État :** terminée et clôturée à 100 %. La baseline d'ouverture était
`main@623fa9e79947e4608f7d2c66d841d053b22684e2`. La livraison et les preuves
techniques sont intégrées sur
`main@8902b56ac8ffc265a1bab085bb6c5d1ffd86e860`.
La spécification est `74_PHASE6_PURCHASES_EXECUTION_SPEC.md`, le statut final
est `75_PHASE_6_STATUS.md`, la preuve consolidée est
`76_PHASE_6_CLOSURE_EVIDENCE.md` et le plan est
`superpowers/plans/2026-10-13-phase-6-purchases-plan.md`.
Le suivi GitHub est l'[issue #75](https://github.com/jupi-z/Monarque-Connect/issues/75).
Les CI PR #229 et #231 ainsi que les CI post-merge #230 et #232 sont vertes.
La phase ne crée pas de
moteur Inventory : les Goods Receipts constatent les réceptions et publient
des événements ; mouvements, réservations et valorisation de stock restent
réservés à la Phase 7.

## Phase 7 — Operations
Inventory, expenses, cash accounts/movements.

**État :** terminée et clôturée à 100 %. La baseline d'ouverture était
`main@3b7245469a2b9ee2a2ccb19c04f621d1d75497ec`. La livraison et la preuve
finales sont intégrées sur
`main@c248f0170a23a1b55b2e0386a5e865d5cc9e96aa`.
Le périmètre, les frontières GoodsReceipt/Inventory, les invariants et le plan
sont définis dans `77_PHASE7_OPERATIONS_EXECUTION_SPEC.md`,
`78_PHASE_7_STATUS.md`,
`79_PHASE_7_CLOSURE_EVIDENCE.md` et
`superpowers/plans/2026-10-14-phase-7-operations-plan.md`.
Le suivi est l'[issue #84](https://github.com/jupi-z/Monarque-Connect/issues/84).
La PR #101, la CI PR #272 et la CI post-merge #273 sont vertes.
La Phase 8 reste fermée.

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
