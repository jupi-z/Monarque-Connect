# 16 — Observabilité et audit

## Logs

JSON structurés : timestamp, level, requestId, route template, status, duration, actor id si sûr, organization id si sûr, establishment id lorsque pertinent. Jamais password/token/secret.

## Metrics techniques

- request rate/error/duration ;
- DB pool/latency ;
- auth failures ;
- entitlement denials par code ;
- quota denials ;
- outbox backlog ;
- storage errors ;
- business counters non sensibles.

## AuditEvent

Obligatoire pour :
- rôle/membership/scope établissement ;
- suspension utilisateur ;
- invitations ;
- changement organization sensible ;
- création/désactivation établissement ;
- changement de plan/subscription ;
- entitlement ALLOW/DENY/LIMIT_OVERRIDE ;
- module activation ;
- quota override ;
- suspension/reprise tenant ;
- émission/void invoice ;
- payment record ;
- supplier RFQ/PO/receipt critique ;
- stock correction ;
- cash correction ;
- connexion/inquiry B2B sensible ;
- actions plateforme/support.

Audit append-only avec `requestId`, actor, tenant, establishment éventuel, cible, action, résultat et contexte filtré.

## Intelligence vs observabilité

Les KPI métier de Monarque Intelligence ne remplacent pas les métriques techniques. Les deux flux restent conceptuellement séparés même s'ils partagent une infrastructure de collecte.
