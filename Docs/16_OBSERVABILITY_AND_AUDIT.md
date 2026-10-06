# 16 — Observabilité et audit

## Logs
JSON structurés : timestamp, level, requestId, route template, status, duration, actor id si sûr, organization id si sûr. Jamais password/token/secret.

## Metrics
- request rate/error/duration ;
- DB pool/latency ;
- auth failures ;
- outbox backlog ;
- storage errors ;
- business counters non sensibles.

## AuditEvent
Obligatoire pour :
- rôle/membership ;
- suspension ;
- invitations ;
- changement organisation sensible ;
- émission/void invoice ;
- payment record ;
- stock correction ;
- connexion B2B ;
- actions plateforme.

Audit append-only avec `requestId`.
