# Phase 9 — Messaging B2B : statut

**Baseline de cadrage :** `main@45b733363f413484f6713b1c5523e119e4def1ec`
**État :** exécution progressive ; Tasks 1 et 2 fusionnées, Task 3 en PR #118 et Tasks 4–5 en implémentation locale empilée dans la PR #119. La Phase 9 n'est pas clôturée.
**Référence normative :** [86_PHASE9_MESSAGING_B2B_EXECUTION_SPEC.md](86_PHASE9_MESSAGING_B2B_EXECUTION_SPEC.md)

## Périmètre approuvé

- conversations REST entre exactement deux organisations reliées par Network `ACCEPTED` ;
- participants utilisateurs explicites, distincts des participants organisationnels ;
- messages texte immuables, attribution serveur et idempotence `clientMessageId` ;
- invitation organisationnelle acceptée par `OWNER`/`ADMIN`, puis invitation utilisateur explicite avec token ;
- autorisation centralisée, entitlements `MESSAGING`, permissions et scopes établissement ;
- blocage relationnel et anti-abus persistant ;
- audit et Outbox atomiques, événements minimisés et versionnés.

## Avancement

| Gate | État |
|---|---|
| Spécification normative | [x] corrigée selon l'audit : invitations, historique, transitions, vérification et anti-abus |
| Écart vérification Network documenté | [x] émetteur vérifié ; destinataire recevable mais non émetteur sans vérification |
| Commande plateforme `VERIFIED` | [x] livrée et fusionnée avec Task 2 : `PUT /platform/organizations/{organizationId}/network-trust`, PR #117 |
| Confidentialité de l'historique | [x] borne `historyVisibleFromSequence` figée |
| Autorité des transitions | [x] suspension/reprise Control Plane uniquement ; pas de fermeture MVP |
| Anti-abus sur refus `429` | [x] preuve commitée avant erreur HTTP, sans message/événement d'envoi |
| Remise des tokens | [x] endpoint REST authentifié, token chiffré au repos et absent des logs/événements |
| Immutabilité Message | [x] trigger PostgreSQL prévu et test direct SQL ajouté au plan |
| Contrats OpenAPI détaillés | [x] draft contract added and validated: 177 operations |
| Plan d'exécution | [x] `Docs/superpowers/plans/2026-10-15-phase-9-messaging-b2b-plan.md` |
| Task 1 — persistance | [x] PR #116 fusionnée sur `main@58e2d8b`; CI PR et post-fusion vertes |
| Task 2 — autorisation et confiance Network | [x] PR #117 fusionnée sur `main@a701c68`; CI PR et post-fusion vertes |
| Task 3 — conversations et invitations | [~] PR #118 ouverte ; CI GitHub non exécutée à cause de la limite de facturation du compte |
| Task 4 — messages immuables | [~] implémentation locale dans PR #119 ; tests DB/E2E à rejouer |
| Task 5 — blocage et anti-abus | [~] implémentation locale dans PR #119 ; preuves PostgreSQL/E2E à ajouter |
| Tests PostgreSQL/E2E/sécurité | [ ] tests ciblés statiques/contractuels verts ; PostgreSQL indisponible localement (Docker daemon arrêté) |
| Preuves de migration Phase 8 → Phase 9 | [~] script `npm run prisma:phase9:migration-proof` versionné ; exécution bloquée par PostgreSQL indisponible |
| Runner local équivalent CI | [~] `npm run ci:local` versionné ; arrêt contrôlé au contrôle Docker tant que le daemon n'est pas disponible |
| CI PR et post-fusion | [ ] PR #119 ouverte ; checks GitHub non démarrés pour cause de facturation du compte |
| Clôture Phase 9 | [ ] |

## Preuves d'exécution déjà obtenues

- Task 1 : PR #116, CI PR [`38656069662`](https://github.com/jupi-z/Monarque-Connect/actions/runs/38656069662), CI post-fusion [`38656556180`](https://github.com/jupi-z/Monarque-Connect/actions/runs/38656556180).
- Task 2 : PR #117, CI PR [`38657951588`](https://github.com/jupi-z/Monarque-Connect/actions/runs/38657951588), CI post-fusion [`38658428563`](https://github.com/jupi-z/Monarque-Connect/actions/runs/38658428563).
- Task 3, avant PR : 4 fichiers ciblés / 8 tests passés, puis suite complète locale de 74 fichiers / 268 tests passés ; la CI GitHub reste la preuve de référence à obtenir.
- Snapshot local du 16 octobre 2026 : Prisma, typecheck, lint, build, OpenAPI (177 opérations), contrats et 10 tests ciblés verts sur `monarque/phase9-messages` à `e041bf5`. `npm run ci:local` s'arrête sans falsifier le résultat lorsque Docker/PostgreSQL n'est pas disponible ; la suite complète avait alors 44 fichiers en échec pour `ECONNREFUSED 127.0.0.1:5432`. GitHub Actions a refusé de démarrer la vérification de PR #119 avec le message de facturation/spend limit du compte.

## Garde-fous

La commande plateforme d'attribution de `VERIFIED` est désormais livrée et testée dans Task 2 ; elle reste une précondition opérationnelle aux premiers envois. Les messages et l'anti-abus sont maintenant implémentés localement dans la branche empilée, mais aucune clôture ne sera déclarée avant les tests PostgreSQL/E2E, les preuves de migrations et les CI PR/post-fusion. Toute décision qui modifierait les invariants des Phases 0 à 8 doit être arrêtée avant son implémentation.

