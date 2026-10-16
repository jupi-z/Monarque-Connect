# Phase 9 — Messaging B2B : preuve d'exécution locale

> Ce document décrit l'état vérifiable de la branche d'implémentation. Il ne remplace pas la preuve CI PR et post-fusion requise pour clôturer la Phase 9.

## Périmètre livré dans la branche

La branche `monarque/phase9-messages` contient l'implémentation des tâches Messaging :

- conversations bilatérales et invitations organisation/utilisateur avec tokens chiffrés au repos ;
- participation explicite, adhésion, départ, révocation et révocation des invitations en attente ;
- messages immuables, attribution serveur, séquence PostgreSQL, `clientMessageId`, idempotence et pagination ;
- blocage relationnel, suspension/reprise interne de modération et anti-abus persistant ;
- audit et Outbox atomiques, événements versionnés minimisés et consommation idempotente par `eventId` ;
- commande plateforme `VERIFIED` fournie par la Task 2 et réutilisée par Messaging ;
- runner `npm run ci:local` et preuve de migrations Phase 9 versionnés.

Les groupes, WebSocket, pièces jointes, recherche plein texte, édition/suppression de messages et IA restent explicitement hors MVP.

## Contrôles locaux réussis — 16 octobre 2026

Depuis la branche `monarque/phase9-messages` :

| Contrôle | Résultat |
|---|---|
| `npm run prisma:validate` | réussi |
| `npm run typecheck` | réussi |
| `npm run lint` | réussi |
| `npm run build` | réussi |
| `npm run openapi:validate` | réussi — 177 opérations |
| `npm run contracts:validate` | réussi |
| tests ciblés Messaging/contrats | réussi — 3 fichiers, 10 tests |
| `git diff --check` | réussi |

Les tests ciblés couvrent la matrice de permissions, la policy Network et les décisions de réservation anti-abus.

## Contrôles non exécutables dans l'environnement courant

`npm run ci:local` est le runner local équivalent à la CI. Il vérifie d'abord Docker et s'arrête avec un résultat non ambigu lorsque le daemon PostgreSQL n'est pas disponible. Le daemon Docker Desktop était indisponible sur le poste et PostgreSQL ne répondait pas sur `127.0.0.1:5432`.

Par conséquent, les contrôles suivants restent à exécuter sur GitHub Actions :

- `prisma migrate deploy` depuis une base vide ;
- upgrade depuis la baseline Phase 8 et `npm run prisma:phase9:migration-proof` ;
- suite PostgreSQL complète et tests E2E HTTP ;
- tests de concurrence, d'isolation tenant, de rollback, d'immutabilité SQL et de rejeu Outbox ;
- non-régression complète des Phases 0 à 8.

La dernière exécution GitHub Actions de la PR #119 n'a pas démarré pour cause de limite de facturation/spend limit du compte. Cette absence n'est pas comptée comme une réussite.

## Gate restante

Il ne reste pas de changement métier ou documentaire local identifié dans cette tranche. La gate restante est GitHub : exécuter la CI de la PR, corriger toute anomalie révélée par PostgreSQL/E2E, fusionner selon la gouvernance, puis vérifier la CI post-fusion sur `main`. La Phase 9 ne sera déclarée clôturée qu'après ces preuves effectives.
