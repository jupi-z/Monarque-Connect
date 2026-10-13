# OpenAPI

`openapi.yaml` est la source normative de la **surface publique API Monarque Connect v1.2**.

Le contrat expose notamment :
- identity/tenancy ;
- establishments ;
- capabilities/modules ;
- CRM/sales ;
- purchases/inventory/cash/projects ;
- Network, trust/verifications et inquiries ;
- Intelligence ;
- exports/portabilité ;
- Control Plane plateforme.

Le fichier de baseline fixe la surface et les operationIds. Avant implémentation de chaque verticale, les schémas de requête/réponse, erreurs, exemples, scopes et règles d'idempotence doivent être détaillés dans la même PR que la verticale.

La surface Sales est désormais implémentée par tranches contrôlées : Quotes,
Sales Orders, Invoices et PaymentRecords. Les contrats restent validés par
`npm run openapi:validate` et toute mutation Sales conserve une clé
`Idempotency-Key` documentée.

## Règles

- aucune route publique implémentée durablement hors contrat ;
- aucun client ne déduit les droits depuis le plan ou business type ;
- `capabilities` est la projection client ;
- l'autorisation réelle reste revalidée sur chaque endpoint ;
- breaking change : version API ou migration documentée.
