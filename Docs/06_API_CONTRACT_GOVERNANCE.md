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

Le serveur vérifie toujours membership, entitlement, activation de module, rôle et scope d'établissement. La présence d'un identifiant dans la requête ne confère aucun droit.

## Capabilities endpoint

`GET /api/v1/organizations/{organizationId}/capabilities` expose au client authentifié une projection sûre de :
- business type public/configuration ;
- plan code/version non sensible ;
- modules effectifs ;
- modules activés ;
- quotas et consommation lorsque pertinente ;
- établissements accessibles au membre ;
- permissions utiles au rendu client.

Cet endpoint est une **projection**, pas la source de vérité d'autorisation. Les autres endpoints revalident systématiquement leurs policies.

## Contrat plateforme

Les routes `/platform/*` utilisent des rôles plateforme séparés. Elles ne sont jamais accessibles grâce à un rôle tenant.

## Compatibilité V1

Compatible :
- ajout endpoint ;
- ajout champ optionnel ;
- ajout module non activé par défaut ;
- ajout valeur extensible lorsque le client est contractuellement tenu de tolérer l'inconnu.

Breaking :
- suppression/renommage ;
- changement de sens ;
- champ devenu obligatoire ;
- modification incompatible de permissions ;
- changement de calcul d'entitlement exposé ;
- auth incompatible.

Un breaking change exige `/api/v2` ou stratégie de migration documentée.

## Contract-first

Avant chaque verticale :
1. module code et entitlement ;
2. schémas OpenAPI ;
3. exemples ;
4. erreurs ;
5. permissions et scopes ;
6. quotas si applicables ;
7. tests contractuels ;
8. seulement ensuite implémentation.
