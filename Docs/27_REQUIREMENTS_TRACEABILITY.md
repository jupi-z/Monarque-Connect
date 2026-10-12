# 27 — Traçabilité

Chaque exigence reçoit un identifiant dans les issues/PR :

- `AUTH-*`
- `TENANT-*`
- `BTYPE-*`
- `EST-*`
- `MEMBER-*`
- `ENT-*`
- `QUOTA-*`
- `PARTY-*`
- `CAT-*`
- `CRM-*`
- `QUOTE-*`
- `ORDER-*`
- `INV-*`
- `PAY-*`
- `PUR-*`
- `EXP-*`
- `CASH-*`
- `STOCK-*`
- `PROJ-*`
- `NET-*`
- `TRUST-*`
- `MSG-*`
- `DOC-*`
- `EVENT-*`
- `PROV-*`
- `KNOW-*`
- `AI-*`
- `AGENT-*`
- `INTEL-*`
- `EXPORT-*`
- `LOC-*`
- `PLATFORM-*`
- `SEC-*`
- `OPS-*`

Une feature PR référence :

`requirement → module_code → entitlement/policy → endpoint/command → event(s) → migration/table → tests → preuve CI`.

Pour une ressource établissement-scopée, la trace inclut aussi le test de scope.

Aucune case cochée dans la DoD sans preuve.

## Phase 3 — Référentiels

| Exigence | Module | Endpoint / invariant | Données / événements | Preuve |
|---|---|---|---|---|
| `PARTY-*` | `CRM` | parties tenant-scoped, filtres, lifecycle | `business_parties`, `business_party.*` | `tests/referentials/parties.integration.test.ts`, PR #45 |
| `CAT-*` | `CATALOG` | produits/services, SKU unique, prix décimal chaîne | `items`, `catalog.item.*` | `tests/referentials/items.integration.test.ts`, PR #46 |
| `INV-*` | `INVENTORY` | warehouses sous établissement et scope membership | `warehouses`, `warehouse.*` | `tests/referentials/warehouses.integration.test.ts`, PR #46 |
| `AUTH-*` / `TENANT-*` | modules actifs + RBAC | tenant → membership → entitlement → activation → permission → scope | audit et Outbox transactionnels | `tests/tenancy/authorization.policy.test.ts`, tests HTTP et CI #158 |
| `OPS-*` | PostgreSQL | migrations additive, unicités et concurrence | migration Phase 3 | `prisma:phase3:migration-proof`, `Docs/62_PHASE_3_CLOSURE_EVIDENCE.md` |
