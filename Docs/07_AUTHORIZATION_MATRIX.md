# 07 — Matrice d'autorisation

## Principe

Le rôle utilisateur n'est que la dernière couche métier de l'autorisation. Toute requête tenant doit d'abord passer :

`tenant active → membership active → entitlement allowed → module active → role permission → establishment scope`.

## Rôles tenant

- `OWNER`
- `ADMIN`
- `SALES`
- `FINANCE`
- `OPERATIONS`
- `VIEWER`

## Rôles plateforme

- `PLATFORM_ADMIN` : configuration produit/tenant, plans, entitlements et opérations plateforme ;
- `PLATFORM_SUPPORT` : support limité et audité, sans droit métier universel.

Les rôles plateforme sont séparés des memberships tenant.

| Domaine | OWNER | ADMIN | SALES | FINANCE | OPERATIONS | VIEWER |
|---|---:|---:|---:|---:|---:|---:|
| Organisation read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Organisation update | ✓ | ✓ | – | – | – | – |
| Établissements read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Établissements write | ✓ | ✓ | – | – | – | – |
| Membres/invitations/scopes | ✓ | ✓ | – | – | – | – |
| Capabilities/entitlements read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Activer/désactiver module autorisé | ✓ | ✓ | – | – | – | – |
| Parties read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Parties write | ✓ | ✓ | ✓ | – | ✓ | – |
| Catalogue read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Catalogue write | ✓ | ✓ | ✓ | – | ✓ | – |
| CRM | ✓ | ✓ | ✓ | read | read | read |
| CRM read (`crm:read`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| CRM write (`crm:write`) | ✓ | ✓ | ✓ | – | – | – |
| Quotes | ✓ | ✓ | ✓ | read | read | read |
| Orders | ✓ | ✓ | ✓ | read | ✓ | read |
| Invoices | ✓ | ✓ | read | ✓ | read | read |
| Payments | ✓ | ✓ | read | ✓ | – | read |
| Purchases/RFQ | ✓ | ✓ | read | read | ✓ | read |
| Inventory read (`inventory:read`) | ✓ | ✓ | – | ✓ | ✓ | ✓ |
| Inventory write (`inventory:write`) | ✓ | ✓ | – | – | ✓ | – |
| Expenses read (`expenses:read`) | ✓ | ✓ | – | ✓ | ✓ | ✓ |
| Expenses write (`expenses:write`) | ✓ | ✓ | – | ✓ | ✓ | – |
| Cash read (`cash:read`) | ✓ | ✓ | – | ✓ | ✓ | ✓ |
| Cash write (`cash:write`) | ✓ | ✓ | – | ✓ | – | – |
| Projects write | ✓ | ✓ | ✓ | read | ✓ | read |
| Network connection/inquiry | ✓ | ✓ | ✓ | – | ✓ | read |
| Network discovery read (`network:discovery:read`) | ✓ | ✓ | ✓ | – | ✓ | ✓ |
| Network profile read (`network:profile:read`) | ✓ | ✓ | ✓ | – | – | – |
| Network profile write (`network:profile:write`) | ✓ | ✓ | – | – | – | – |
| Network trust read (`network:trust:read`) | ✓ | ✓ | ✓ | – | – | – |
| Network connections read/write | ✓/✓ | ✓/✓ | ✓/✓ | –/– | ✓/✓ | ✓/– |
| Network inquiries read/write | ✓/✓ | ✓/✓ | ✓/✓ | –/– | ✓/✓ | ✓/– |
| Messaging | ✓ | ✓ | ✓ | ✓ | ✓ | read |
| Insights read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Export tenant | ✓ | ✓ | – | – | – | – |
| Audit read | ✓ | ✓ | – | – | – | – |

## Scope d'établissement

- `ALL_ESTABLISHMENTS` : accès aux établissements autorisés par le rôle ;
- `SELECTED_ESTABLISHMENTS` : intersection entre le rôle et la liste de scopes ;
- aucune ressource d'un établissement hors scope ne doit être révélée, y compris par ID direct ;
- OWNER reçoit `ALL_ESTABLISHMENTS` par défaut ;
- ADMIN peut être limité explicitement si la gouvernance du tenant l'exige.

## Entitlements

Un rôle ne peut jamais contourner un entitlement. Exemple : OWNER n'accède pas à `PURCHASES` si le tenant n'a pas cette capacité effective.

Un administrateur tenant peut désactiver un module autorisé, mais ne peut pas s'accorder un module absent de ses entitlements.

## Règles

- deny-by-default ;
- dernier OWNER actif protégé ;
- VIEWER n'écrit jamais ;
- plateforme et tenant sont deux plans d'autorisation distincts ;
- toute action platform support est justifiée, limitée et auditée ;
- type d'entreprise et plan ne sont jamais acceptés comme preuve d'autorisation utilisateur.
