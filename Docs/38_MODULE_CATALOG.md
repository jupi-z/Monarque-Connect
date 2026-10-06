# 38 — Catalogue canonique des modules

## Modules core non-gatables

Toujours présents techniquement :
- AUTH
- ORGANIZATION
- ESTABLISHMENTS
- MEMBERSHIPS
- PLATFORM_SECURITY
- DATA_PORTABILITY

Ils peuvent avoir des quotas, mais ne sont pas désactivés comme des modules commerciaux.

## Modules commerciaux MVP

| Code | Pilier | Dépendances |
|---|---|---|
| `CATALOG` | Business OS / Network | core |
| `CRM` | Business OS | core |
| `SALES` | Business OS | CATALOG |
| `PURCHASES` | Business OS | CATALOG |
| `INVENTORY` | Business OS | CATALOG |
| `EXPENSES` | Business OS | core |
| `CASH` | Business OS | core |
| `PROJECTS` | Business OS | core |
| `DOCUMENTS` | Business OS | core |
| `NETWORK_PROFILE` | Network | core |
| `NETWORK_TRUST` | Network | NETWORK_PROFILE |
| `NETWORK_DISCOVERY` | Network | core |
| `NETWORK_CONNECTIONS` | Network | NETWORK_DISCOVERY |
| `NETWORK_INQUIRIES` | Network | NETWORK_PROFILE |
| `MESSAGING` | Network | NETWORK_CONNECTIONS |
| `INTELLIGENCE_BASIC` | Intelligence | au moins un module métier actif |

## Disponibilité

`availability` :
- `MVP`
- `BETA`
- `FUTURE`
- `RETIRED`

Un module FUTURE ne peut pas être activé par un plan actif de production.

## Dépendances

L'activation d'un module exige que ses dépendances soient entitled et actives, sauf dépendance explicitement `optional`.

Le code `NETWORK_TRUST` couvre vérification et signaux de confiance publiables. Les notes publiques, avis et scores réputationnels opaques sont hors MVP.

Désactiver une dépendance :
- bloque d'abord les nouvelles écritures du module dépendant ;
- exige une stratégie de déactivation documentée ;
- ne supprime jamais les données historiques.

## Ajout d'un module

Chaque nouveau module doit définir :
1. code stable ;
2. pilier ;
3. dépendances ;
4. endpoints ;
5. permissions ;
6. establishment scope ;
7. quota éventuel ;
8. audit ;
9. événements ;
10. tests ;
11. stratégie de désactivation.
