# 13 — Erreurs, idempotence, pagination

## Erreurs
RFC 9457 `application/problem+json` :
- `type`
- `title`
- `status`
- `detail`
- `instance`
- `requestId`
- `code` métier stable

## Idempotence
Header `Idempotency-Key` obligatoire pour :
- acceptation d'invitation ;
- conversion quote→order ;
- conversion order→invoice ;
- création payment record ;
- mouvement stock critique ;
- opérations réseau sensibles.

La clé est scoped par user/tenant/operation et liée au hash de la requête.

## Pagination
Curseur opaque versionné, keyset pagination.  
Jamais de pagination offset sur les collections potentiellement volumineuses.  
Limite par défaut 20, max 100 sauf exception documentée.
