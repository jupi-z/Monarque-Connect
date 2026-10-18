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

## Stabilisation corrective de revue — branche en cours

Les écarts identifiés par la revue indépendante sont traités sans refonte :

- un rejeu `clientMessageId` exact retourne le message existant, même avec une nouvelle clé HTTP, tandis qu'un payload divergent est refusé sans quota ni séquence supplémentaire ;
- les décisions d'invitation et la remise idempotente des tokens sont sérialisées par verrou PostgreSQL, et les receipts de token ne stockent jamais le token en clair ;
- les compteurs anti-abus conservent une ligne par empreinte et par fenêtre, y compris lorsqu'une autre empreinte est intercalée ;
- les secrets d'invitation et d'anti-abus échouent fermement en `staging`/`production` sans clé dédiée et n'utilisent plus la clé JWT ;
- l'autorisation d'envoi est revalidée dans la transaction avec verrouillage du membership et des participants ;
- un trigger PostgreSQL empêche l'insertion d'un message dont l'organisation source ou l'auteur ne respecte pas les participants actifs ;
- les erreurs d'invitation expirée sont contractuellement exposées en `410 Gone` ;
- les PR sont exécutées sur un runner GitHub isolé via l'événement standard `pull_request`, tandis que le runner auto-hébergé persistant est réservé aux pushes de `main` ; `pull_request_target` n'est pas utilisé pour exécuter le code de la PR.

Les migrations ajoutées sont `20261018010000_persist_messaging_abuse_fingerprints` et `20261018011000_enforce_messaging_message_invariants`. Elles doivent encore être prouvées dans la CI complète avant de faire évoluer les cases de clôture.

## Contrôles locaux réussis — 18 octobre 2026

Depuis la branche `monarque/phase9-messages`, commit contrôlé `5f2cbb9f5b4cd9774c55bdeae7f5d09768075eca` (PR [#119](https://github.com/jupi-z/Monarque-Connect/pull/119)), sur une base PostgreSQL de test fraîche :

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

Le runner `monarque-connect-ci` a été enregistré sur GitHub le 18 octobre 2026. Le service systemd est activé et actif dans WSL Ubuntu 22.04 ; son journal confirme `Connected to GitHub`, `Listening for Jobs` et l'exécution du job `validate`. La CI cumulative de la branche d'implémentation est vérifiable dans le run [`39148395178`](https://github.com/jupi-z/Monarque-Connect/actions/runs/39148395178), conclu `success`.

L'enregistrement du runner ne stocke aucun jeton dans le dépôt. Les contrôles suivants sont maintenant couverts par le run GitHub #327 :

- `prisma migrate deploy` depuis une base vide ;
- upgrade depuis la baseline Phase 8 et `npm run prisma:phase9:migration-proof` ;
- suite PostgreSQL complète et tests E2E HTTP ;
- tests de concurrence, d'isolation tenant, de rollback, d'immutabilité SQL et de rejeu Outbox ;
- non-régression complète des Phases 0 à 8.

L'exécution GitHub Actions [#324 / run 38912178681](https://github.com/jupi-z/Monarque-Connect/actions/runs/38912178681) associée au précédent commit est `failure` avant exécution utile pour cause de limite de facturation/spend limit du compte. Cette absence n'est pas comptée comme une réussite. Une nouvelle exécution devra être observée après mise en ligne du runner.

## Gates restantes

Il ne reste pas de correction métier révélée par les contrôles locaux ou la CI cumulative #327. Les gates restantes sont l'intégration ordonnée des PR #118 puis #119 (la seconde est actuellement empilée sur la première), la CI post-fusion sur `main`, puis la vérification finale de l'état des branches et de la documentation. La Phase 9 ne sera déclarée clôturée qu'après ces preuves effectives.
