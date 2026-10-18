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

## Contrôles locaux réussis — 18 octobre 2026

Depuis la branche `monarque/phase9-messages`, commit contrôlé `9af5619` (PR [#119](https://github.com/jupi-z/Monarque-Connect/pull/119)), sur une base PostgreSQL de test fraîche :

| Contrôle | Résultat |
|---|---|
| `npm run prisma:validate` | réussi |
| `npm run typecheck` | réussi |
| `npm run lint` | réussi |
| `npm run build` | réussi |
| `npm run openapi:validate` | réussi — 177 opérations |
| `npm run contracts:validate` | réussi |
| `npm test` | réussi — 75 fichiers, 272 tests |
| `npm run test:e2e` | réussi — 7 fichiers, 14 tests |
| preuves migration Phase 2, 3, 5, 6, 7, 8 et 9 | réussies — bases neuves et upgrades PostgreSQL dédiés |
| `git diff --check` | réussi |

Les tests couvrent la matrice de permissions, la policy Network, les décisions de réservation anti-abus, les parcours HTTP, l'isolation tenant, l'idempotence, les rejeux, la concurrence et l'immutabilité SQL.

## Préparation de l'exécution GitHub

`npm run ci:local` reste le runner local équivalent à la CI. La configuration GitHub cible désormais un runner Linux auto-hébergé portant les labels `self-hosted`, `linux`, `x64`, `monarque-ci`. Son service PostgreSQL utilise le port hôte `55432`, distinct du PostgreSQL de développement sur `5432`.

L'enregistrement du runner ne stocke aucun jeton dans le dépôt et doit être vérifié directement dans les paramètres GitHub du dépôt. Tant que ce runner n'est pas confirmé `online`, les contrôles suivants ne sont pas comptés comme preuves GitHub :

- `prisma migrate deploy` depuis une base vide ;
- upgrade depuis la baseline Phase 8 et `npm run prisma:phase9:migration-proof` ;
- suite PostgreSQL complète et tests E2E HTTP ;
- tests de concurrence, d'isolation tenant, de rollback, d'immutabilité SQL et de rejeu Outbox ;
- non-régression complète des Phases 0 à 8.

L'exécution GitHub Actions [#324 / run 38912178681](https://github.com/jupi-z/Monarque-Connect/actions/runs/38912178681) associée au précédent commit est `failure` avant exécution utile pour cause de limite de facturation/spend limit du compte. Cette absence n'est pas comptée comme une réussite. Une nouvelle exécution devra être observée après mise en ligne du runner.

## Gate restante

Il ne reste pas de correction métier révélée par les contrôles locaux. La gate restante est GitHub : enregistrer et mettre en ligne le runner, exécuter la CI de la PR, corriger toute anomalie révélée, fusionner selon la gouvernance, puis vérifier la CI post-fusion sur `main`. La Phase 9 ne sera déclarée clôturée qu'après ces preuves effectives.
