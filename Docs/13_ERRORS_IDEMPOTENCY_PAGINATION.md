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

Codes métier recommandés :
- `ENTITLEMENT_REQUIRED`
- `MODULE_DISABLED`
- `QUOTA_EXCEEDED`
- `ESTABLISHMENT_SCOPE_DENIED`
- `TENANT_SUSPENDED`
- `INVALID_STATE_TRANSITION`
- `IDEMPOTENCY_CONFLICT`

Le status HTTP ne suffit pas au client pour expliquer une limitation fonctionnelle.

## Idempotence

Header `Idempotency-Key` obligatoire pour :
- acceptation d'invitation ;
- conversion inquiry→lead/opportunity ;
- conversion quote→order ;
- conversion order→invoice ;
- création payment record ;
- confirmation goods receipt ;
- mouvement stock critique ;
- mouvement cash manuel ;
- opérations réseau créatrices d'effet ;
- opérations plateforme de changement de subscription/entitlement si l'endpoint le prévoit.

La clé est scoped par actor/tenant/operation et liée au hash de la requête.

Une même clé avec un payload différent produit `409 IDEMPOTENCY_CONFLICT`.

## Pagination

Curseur opaque versionné, keyset pagination.

- défaut 20 ;
- max 100 sauf exception ;
- tenant, entitlement, RBAC et establishment scope sont appliqués avant création du curseur ;
- un curseur ne peut pas être réutilisé dans un autre tenant/scope.
