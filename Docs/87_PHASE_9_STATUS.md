# Phase 9 — Messaging B2B : statut

**Baseline de cadrage :** `main@1c15d2c014d1e9eb19ecb7e71ee1c375f943c38f`  
**État :** cadrage normatif corrigé après audit ; plan et contrats à préparer.
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
| Commande plateforme `VERIFIED` | [ ] absente du code actuel ; tranche Control Plane minimale requise avant le premier envoi |
| Confidentialité de l'historique | [x] borne `historyVisibleFromSequence` figée |
| Autorité des transitions | [x] suspension/reprise Control Plane uniquement ; pas de fermeture MVP |
| Anti-abus sur refus `429` | [x] preuve commitée avant erreur HTTP, sans message/événement d'envoi |
| Remise des tokens | [x] endpoint REST authentifié, token chiffré au repos et absent des logs/événements |
| Immutabilité Message | [x] trigger PostgreSQL prévu et test direct SQL ajouté au plan |
| Contrats OpenAPI détaillés | [x] draft contract added and validated: 177 operations |
| Plan d'exécution | [x] `Docs/superpowers/plans/2026-10-15-phase-9-messaging-b2b-plan.md` |
| Modèles et migration Prisma | [ ] |
| Services/controllers métier | [ ] |
| Tests PostgreSQL/E2E/sécurité | [ ] |
| Preuves de migration Phase 8 → Phase 9 | [ ] |
| CI PR et post-fusion | [ ] |
| Clôture Phase 9 | [ ] |

## Garde-fous

Il n'y a actuellement aucun changement de code métier ni migration dans cette branche. La spécification, le plan et le contrat OpenAPI de cadrage sont versionnés ; l'OpenAPI a été validée localement à 175 opérations. Toute décision qui modifierait les invariants des Phases 0 à 8 doit être arrêtée avant son implémentation.

