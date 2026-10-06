# 06 — Gouvernance du contrat API

## Autorité
`openapi/openapi.yaml` est le contrat public normatif. L'implémentation NestJS doit s'y conformer.

## Base
- `/api/v1`
- JSON UTF-8
- HTTPS obligatoire en production
- Bearer access token
- UUID
- RFC3339 UTC
- Problem Details RFC 9457 pour les erreurs

## Tenant context
Les ressources privées utilisent un path explicite :

`/api/v1/organizations/{organizationId}/...`

Le serveur vérifie toujours le membership. La présence d'un `organizationId` dans la requête ne confère aucun droit.

## Compatibilité V1
Compatible : ajout endpoint, ajout champ optionnel.  
Breaking : suppression/renommage, changement de sens, champ devenu obligatoire, status code contractuel incompatible, auth incompatible.

Un breaking change exige `/api/v2` ou stratégie de migration documentée.

## Contract-first
Avant chaque verticale :
1. schémas OpenAPI ;
2. exemples ;
3. erreurs ;
4. permissions ;
5. tests contractuels ;
6. seulement ensuite implémentation.
