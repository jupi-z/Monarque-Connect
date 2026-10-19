# Phase 9 — Messaging B2B : statut

**État au 19 octobre 2026 :** clôturée techniquement et documentairement sur `main@6941f9108ce9ff3182201c03f8f0bb8df8342459`.

**Références normatives :**

- [86_PHASE9_MESSAGING_B2B_EXECUTION_SPEC.md](86_PHASE9_MESSAGING_B2B_EXECUTION_SPEC.md)
- [plan d'exécution](superpowers/plans/2026-10-15-phase-9-messaging-b2b-plan.md)
- [preuve d'exécution](88_PHASE_9_EXECUTION_EVIDENCE.md)

## Périmètre livré

- conversations REST bilatérales entre deux organisations reliées par Network `ACCEPTED` ;
- participants organisationnels et utilisateurs explicites, avec invitations et tokens protégés ;
- messages texte immuables, attribution serveur, séquence PostgreSQL, pagination et idempotence ;
- autorisation centralisée par tenant, entitlement `MESSAGING`, permission et scope établissement ;
- blocage relationnel, suspension/reprise de modération et anti-abus persistant ;
- audit et Outbox atomiques, événements versionnés minimisés et consumers idempotents ;
- commande plateforme de vérification Network `VERIFIED` réutilisée par Messaging.

Les conversations de groupe, WebSocket, pièces jointes, recherche plein texte, édition/suppression de messages et IA restent hors MVP.

## Gates

| Gate | État | Preuve |
|---|---|---|
| Spécification, autorisations et frontières | [x] | `Docs/86_PHASE9_MESSAGING_B2B_EXECUTION_SPEC.md` |
| Persistance, migrations et invariants PostgreSQL | [x] | 45 migrations déployées ; preuve Phase 9 dans la CI |
| Conversations, invitations et tokens | [x] | PR #118 fusionnée |
| Messages, idempotence et concurrence | [x] | PR #120 fusionnée |
| Blocage, suspension et anti-abus | [x] | PR #120 fusionnée |
| Audit, Outbox et consumers | [x] | PR #120 fusionnée |
| OpenAPI et contrats | [x] | 177 opérations validées |
| Tests PostgreSQL et régressions | [x] | CI PR #120 et CI post-fusion |
| Tests HTTP/E2E | [x] | CI PR #120 et CI post-fusion |
| CI PR | [x] | [run 39223880612](https://github.com/jupi-z/Monarque-Connect/actions/runs/39223880612) |
| CI post-fusion `main` | [x] | [run 39224474237](https://github.com/jupi-z/Monarque-Connect/actions/runs/39224474237) |
| Clôture Phase 9 | [x] | PR #120, `main@6941f91` |

## Gouvernance

La fusion a suivi le processus branche dédiée → PR → CI GitHub hébergée → squash merge → CI post-fusion. Les branches de travail Phase 9 ont été supprimées ; `main` est la seule branche distante restante. La ruleset `main` impose une PR, interdit les suppressions et non-fast-forward, autorise le squash et exige `validate-pr / validate`, sans approbation humaine bloquante.

La protection de `main` reste suivie par l'issue [#6](https://github.com/jupi-z/Monarque-Connect/issues/6) pour les évolutions de gouvernance qui ne conditionnent pas la clôture fonctionnelle de cette phase.
