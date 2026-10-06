# 27 — Traçabilité

Chaque exigence reçoit un identifiant dans les issues/PR :
- `AUTH-*`
- `TENANT-*`
- `PARTY-*`
- `CAT-*`
- `CRM-*`
- `QUOTE-*`
- `ORDER-*`
- `INV-*`
- `PAY-*`
- `EXP-*`
- `STOCK-*`
- `NET-*`
- `MSG-*`
- `DOC-*`
- `PLATFORM-*`
- `SEC-*`
- `OPS-*`

Une feature PR référence :
`requirement → endpoint → migration/table → tests → preuve CI`.

Aucune case cochée dans la DoD sans preuve.
