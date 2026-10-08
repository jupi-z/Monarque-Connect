# 54 — Spécification d'exécution Phase 1 — Identity & Tenancy

## Objectif

Implémenter l'identité, l'isolation tenant/établissement et l'autorisation de base avant toute verticale métier.

## Périmètre

- utilisateurs, register/login/refresh/logout et sessions de refresh ;
- organisations et types d'entreprise seedables/extensibles ;
- création atomique de l'organisation et de son établissement principal ;
- établissements, memberships et invitations ;
- rôles tenant et scopes `ALL_ESTABLISHMENTS` / `SELECTED_ESTABLISHMENTS` ;
- isolation tenant et établissement, deny-by-default ;
- audit des changements sensibles ;
- événements Domain Event écrits dans la même transaction via l'Outbox Writer.

## Invariants de sortie

1. Un utilisateur ne lit ni ne modifie jamais les données d'un autre tenant.
2. Un utilisateur ne lit ni ne modifie jamais un établissement hors de son scope effectif.
3. Le serveur revalide identité, membership, rôle, scope et statut du tenant à chaque action.
4. La création d'une organisation crée son établissement principal et les invariants associés dans une transaction unique.
5. Les refus d'autorisation sont deny-by-default et couverts par des tests cross-tenant/cross-establishment.
6. Les contrats OpenAPI des parcours `login → me → organizations → active establishment → capabilities` sont détaillés et versionnés. L'établissement actif est un contexte de requête explicite (`establishmentId`), validé par l'autorisation serveur à chaque appel ; il n'est pas copié dans les claims JWT.

## Gate

La Phase 1 ne peut être déclarée terminée qu'après migrations depuis base vide, tests d'isolation réels, tests RBAC, audit, CI verte et revue de la PR de livraison.

Les événements de la Phase 1 réutilisent l'Event Fabric de la Phase 0.5 ; aucune transaction métier ne doit créer un événement dans une seconde transaction.
