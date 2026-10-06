# 07 — Matrice d'autorisation

## Rôles tenant
- `OWNER`
- `ADMIN`
- `SALES`
- `FINANCE`
- `OPERATIONS`
- `VIEWER`

## Rôle plateforme
- `PLATFORM_ADMIN` : administration Monarque Group, séparée de tout membership.

| Domaine | OWNER | ADMIN | SALES | FINANCE | OPERATIONS | VIEWER |
|---|---:|---:|---:|---:|---:|---:|
| Organisation read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Organisation update | ✓ | ✓ | – | – | – | – |
| Membres/invitations | ✓ | ✓ | – | – | – | – |
| Parties read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Parties write | ✓ | ✓ | ✓ | – | ✓ | – |
| Catalogue read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Catalogue write | ✓ | ✓ | ✓ | – | ✓ | – |
| CRM | ✓ | ✓ | ✓ | read | read | read |
| Quotes | ✓ | ✓ | ✓ | read | read | read |
| Orders | ✓ | ✓ | ✓ | read | ✓ | read |
| Invoices | ✓ | ✓ | read | ✓ | read | read |
| Payments | ✓ | ✓ | read | ✓ | – | read |
| Expenses | ✓ | ✓ | – | ✓ | ✓ | read |
| Inventory write | ✓ | ✓ | – | read | ✓ | read |
| Network connection | ✓ | ✓ | ✓ | – | ✓ | read |
| Messaging | ✓ | ✓ | ✓ | ✓ | ✓ | read |
| Audit read | ✓ | ✓ | – | – | – | – |

## Règles
- deny-by-default ;
- `OWNER` ne peut pas être supprimé sans transfert explicite ;
- dernier OWNER actif protégé ;
- VIEWER n'écrit jamais ;
- plateforme et tenant sont deux plans d'autorisation distincts.
