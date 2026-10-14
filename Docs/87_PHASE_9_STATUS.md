# Phase 9 — Messaging B2B : statut

**Baseline de cadrage :** `main@1c15d2c014d1e9eb19ecb7e71ee1c375f943c38f`  
**État :** cadrage normatif en revue ; implémentation non commencée.  
**Référence normative :** [86_PHASE9_MESSAGING_B2B_EXECUTION_SPEC.md](86_PHASE9_MESSAGING_B2B_EXECUTION_SPEC.md)

## Périmètre approuvé

- conversations REST entre exactement deux organisations reliées par Network `ACCEPTED` ;
- participants utilisateurs explicites, distincts des participants organisationnels ;
- messages texte immuables, attribution serveur et idempotence `clientMessageId` ;
- autorisation centralisée, entitlements `MESSAGING`, permissions et scopes établissement ;
- blocage relationnel et anti-abus persistant ;
- audit et Outbox atomiques, événements minimisés et versionnés.

## Avancement

| Gate | État |
|---|---|
| Spécification normative | [x] rédigée, revue utilisateur requise |
| Écart vérification Network documenté | [x] identifié ; implémentation à planifier |
| Contrats OpenAPI détaillés | [ ] |
| Modèles et migration Prisma | [ ] |
| Services/controllers métier | [ ] |
| Tests PostgreSQL/E2E/sécurité | [ ] |
| Preuves de migration Phase 8 → Phase 9 | [ ] |
| CI PR et post-fusion | [ ] |
| Clôture Phase 9 | [ ] |

## Garde-fous

Il n'y a actuellement aucun changement de code métier, migration ou contrat OpenAPI dans cette branche. Le plan d'exécution sera écrit après revue et validation de la spécification normative. Toute décision qui modifierait les invariants des Phases 0 à 8 doit être arrêtée avant son implémentation.

