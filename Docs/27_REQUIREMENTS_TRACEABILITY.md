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
