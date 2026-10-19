# Phase 9 Messaging B2B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter des conversations REST privées entre deux organisations Network, avec invitations explicites, messages immuables, autorisation centralisée, anti-abus persistant et Outbox atomique.

**Architecture:** Le domaine Messaging s'appuie sur `ConnectionRequest` en statut `ACCEPTED` et sur `OrganizationNetworkTrust` sans créer de relation Network parallèle. Une conversation possède exactement deux participants organisationnels, des participants utilisateurs explicites et une frontière d'historique par adhésion ; les mutations passent par des transactions Prisma/PostgreSQL et l'Event Fabric existant.

**Tech Stack:** NestJS 12, TypeScript 5.9, Prisma 7/PostgreSQL, OpenAPI 3.1, Vitest, Supertest, Outbox Event Fabric existant.

**Spec:** `Docs/86_PHASE9_MESSAGING_B2B_EXECUTION_SPEC.md`

## Contraintes globales

- Une conversation relie exactement deux organisations distinctes et réutilise uniquement une connexion Network `ACCEPTED`.
- L'émetteur d'une création, invitation ou message doit être `VERIFIED` et non expiré ; le destinataire peut recevoir avant sa propre vérification, mais ne peut pas émettre sans elle.
- L'organisation et l'utilisateur sont des participants distincts ; l'appartenance seule ne donne jamais accès aux conversations.
- Un UUID seul ne permet pas d'accepter une invitation : membership, organisation ciblée, invitation `PENDING`, token et policy doivent tous correspondre.
- L'historique visible commence à `historyVisibleFromSequence` pour chaque adhésion ; aucune réadhésion ne donne d'accès rétroactif.
- Le MVP ne comporte ni groupe, WebSocket, pièce jointe, édition/suppression de message, fermeture publique ou nouvelle transition Network.
- Les messages n'acceptent jamais `authorUserId`, `sourceOrganizationId` ou `sequence` du client.
- Les mutations d'état, audits et événements Outbox sont atomiques ; un `429` persiste le dépassement mais ne produit ni message ni `message.sent`.
- Aucun code métier des Phases 0 à 8 ne doit être refondu silencieusement.

## Review Focus

- Invitation connue par UUID mais token ou organisation incorrects : test d'absence d'adhésion et d'accès.
- Utilisateur réinvité après départ/révocation : test de borne d'historique sans lecture rétroactive.
- Expiration de vérification asymétrique : test de réception autorisée et d'émission refusée.
- Course entre deux invitations, deux acceptations ou deux messages : contraintes uniques et séquences déterministes.
- Limite dépassée : compteur et audit persistants, aucun message ni événement d'envoi fantôme.

---

### Task 1: Figer les types persistants et la migration PostgreSQL — TERMINÉE

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_phase9_messaging_b2b/migration.sql`
- Test: `tests/phase9-messaging.persistence.test.ts`

**Interfaces:**
- Produces `Conversation`, `ConversationOrganizationParticipant`, `ConversationUserParticipant`, `MessagingInvitation`, `Message`, `MessagingOrganizationBlock` et `MessagingRateBucket`.
- Expose les enums `MessagingConversationStatus` (`OPEN`, `SUSPENDED`), `MessagingInvitationType`, `MessagingInvitationStatus` et `MessagingParticipantStatus`.

- [x] Ajouter les modèles avec FKs tenant-cohérentes, timestamps, acteurs d'audit et index de lecture.
- [x] Ajouter `lastMessageSequence` et `historyVisibleFromSequence` en `BIGINT`/`BigInt` selon les conventions Prisma du dépôt.
- [x] Ajouter les contraintes SQL non exprimables par Prisma : paire d'organisations distinctes et canonique, exactement deux organisations par conversation, types d'invitation avec cible valide, bornes de compteurs et unicités d'invitations actives.
- [x] Ajouter `Message` avec les unicités `(conversationId, sequence)`, `(conversationId, authorUserId, clientMessageId)` et `(conversationId, organizationId, userId)` pour les participants.
- [x] Ajouter au SQL un trigger `BEFORE UPDATE OR DELETE` sur `messages` qui lève `message_immutable`, tester directement update/delete dans PostgreSQL et valider la migration par la CI cumulative #327.
- [x] Écrire le test PostgreSQL qui vérifie les contraintes depuis une base réelle et refuse les doublons/cross-tenant incohérents ; validation observée dans la CI cumulative #327.
- [x] Exécuter `npm run prisma:validate` puis `npx prisma migrate deploy` sur la base de test et vérifier les objets Phase 9 ; validation observée dans la CI cumulative #327.
- [x] PR #116 fusionnée sur `main@58e2d8b6490d97a22cec5863fcded859ea8a76b1`; CI PR et post-fusion vertes.

### Task 2: Centraliser la policy Network, vérification et autorisation Messaging — TERMINÉE

**Files:**
- Modify: `src/tenancy/authorization.service.ts`
- Create: `src/network/messaging-policy.service.ts`
- Create: `src/messaging/messaging.authorization.ts`
- Modify: `src/network/network.module.ts`
- Test: `tests/phase9-messaging.authorization.test.ts`

**Interfaces:**
- `MessagingPolicy.assertCanInitiate(tx, actor, sourceOrganizationId, targetOrganizationId)` vérifie organisation active, relation `ACCEPTED`, source `VERIFIED` non expirée, cible active/profil/entitlement et absence de blocage.
- `MessagingPolicy.assertCanSend(tx, actor, conversationId)` revalide la même policy, la conversation `OPEN`, les deux organisations participantes et les deux côtés avec participant utilisateur actif.
- `MessagingAuthorization.requireParticipantAccess(...)` applique membership, entitlement `MESSAGING`, permission et `historyVisibleFromSequence`.
- `NetworkTrustCommandService.set(actor, organizationId, input, idempotencyKey)` est la commande Control Plane minimale d'attribution/révocation de `VERIFIED`.

- [x] Ajouter les permissions `messaging:read`, `messaging:write`, `messaging:participants:write` et `messaging:block:write` à la matrice centralisée, sans autoriser `VIEWER` à écrire.
- [x] Implémenter `PUT /platform/organizations/:organizationId/network-trust` avec `PlatformAuthorizationService`, raison obligatoire, verrouillage de la ligne trust, idempotence, audit et `organization.verification_changed`; échouer fermé si la commande ou sa configuration de clé n'est pas disponible.
- [x] Implémenter la vérification asymétrique : l'émetteur doit être `VERIFIED`/non expiré ; le destinataire peut accepter et lire sans vérification mais ne peut pas envoyer.
- [x] Filtrer les participations et organisations dans chaque query d'autorisation avant d'appeler les services métier.
- [x] Retourner `404` pour un acteur non participant afin de réduire l'oracle de ressource ; conserver les `403` normalisés pour une ressource connue mais interdite.
- [x] Couvrir les rôles, entitlements, scopes, `UNVERIFIED`, `EXPIRED`, connexion non acceptée, suspension et blocage dans les tests versionnés ; l'exécution PostgreSQL complète reste une gate CI.
- [x] PR #117 fusionnée sur `main@a701c688f6694429ab57fcd68268494fbf186570`; CI PR et post-fusion vertes.

### Task 3: Implémenter conversations et invitations explicites — IMPLÉMENTÉE, CI EN ATTENTE

**Files:**
- Create: `src/messaging/messaging.module.ts`
- Create: `src/messaging/conversation.controller.ts`
- Create: `src/messaging/conversation.dto.ts`
- Create: `src/messaging/conversation.service.ts`
- Create: `src/messaging/invitation.controller.ts`
- Create: `src/messaging/invitation.dto.ts`
- Create: `src/messaging/invitation.service.ts`
- Modify: `src/app.module.ts`
- Test: `tests/phase9-messaging.conversations.test.ts`
- Test: `tests/e2e/phase9-messaging.e2e.test.ts`

**Interfaces:**
- `ConversationService.create(actor, organizationId, input, idempotencyKey): Promise<ConversationDto>` crée la paire canonique et une invitation organisationnelle, sans message initial.
- `InvitationService.accept(actor, organizationId, invitationId, token, idempotencyKey): Promise<InvitationDto>` active l'organisation ou l'utilisateur ciblé selon le type.
- `InvitationService.createUserInvitation(actor, conversationId, userId, idempotencyKey): Promise<InvitationDto>` crée une invitation adressée à un membre actif de sa propre organisation.
- `InvitationService.issueToken(actor, organizationId, invitationId, idempotencyKey): Promise<{ invitationId: string; token: string; expiresAt: Date }>` remet le token uniquement à l'administrateur destinataire ou à l'utilisateur ciblé.

- [x] Créer une conversation uniquement si la paire n'existe pas et que la policy Network est satisfaite ; une course concurrente devient `409` sans seconde conversation.
- [x] Générer un token aléatoire, ne conserver que son hash, borner son expiration et ne jamais inclure de contenu privé dans la boîte d'invitations.
- [x] Conserver le token uniquement sous forme chiffrée avec `MESSAGING_INVITATION_TOKEN_KEY` pour sa remise REST ; ne jamais le journaliser, auditer, publier dans l'Outbox ou retourner à l'organisation source.
- [x] Ajouter l'endpoint de remise token à usage court et unique ; une nouvelle demande autorisée après expiration invalide l'ancien token et en émet un nouveau.
- [x] Réserver la consultation des invitations organisationnelles à `OWNER`/`ADMIN` du destinataire et des invitations utilisateur à l'utilisateur ciblé.
- [x] Exiger token, membership, cible, expiration et policy au moment de l'acceptation ; rendre acceptation/refus idempotents et divergents `409`.
- [x] Persister le résultat d'acceptation par `Idempotency-Key` afin qu'un retry réseau retourne le résultat sans réutiliser ni revalider le token.
- [x] Interdire tout `participants/me` et toute adhésion directe par UUID.
- [x] Implémenter départ volontaire et révocation par l'autorité de l'organisation, avec suppression immédiate de l'accès et borne de réadhésion future.
- [x] Couvrir en HTTP les réponses `401/403/404/409` et l'absence totale de messages avant adhésion dans le scénario E2E versionné.
- [~] PR #118 reste ouverte ; sa validation cumulative PostgreSQL/E2E est couverte par la CI verte de PR #119, mais l'intégration ordonnée reste à effectuer.

### Task 4: Implémenter messages immuables, idempotence et pagination — IMPLÉMENTÉE, CI EN ATTENTE

**Files:**
- Create: `src/messaging/message.controller.ts`
- Create: `src/messaging/message.dto.ts`
- Create: `src/messaging/message.service.ts`
- Test: `tests/phase9-messaging.messages.test.ts`
- Test: `tests/e2e/phase9-messaging.e2e.test.ts`

**Interfaces:**
- `MessageService.send(actor, organizationId, conversationId, input, idempotencyKey): Promise<MessageDto>`.
- `MessageService.list(actor, organizationId, conversationId, cursor, limit): Promise<MessagePageDto>`.

- [x] Valider le texte borné et canonicaliser uniquement pour l'anti-abus ; persister le corps original comme contenu immuable.
- [x] Verrouiller la conversation en PostgreSQL, revalider l'autorisation et incrémenter `lastMessageSequence` dans la même transaction.
- [x] Retourner la ligne existante pour une commande canonique rejouée et `409` pour une même clé divergente, sans fuite cross-actor.
- [x] Rechercher la clé idempotente et comparer la commande avant toute réservation anti-abus ; un rejeu accepté ne touche ni buckets, ni audit anti-abus, ni Outbox.
- [x] Filtrer les lectures sur `historyVisibleFromSequence`, participant actif, scope et policy ; ne jamais exposer l'historique antérieur à une réadhésion.
- [x] Implémenter un curseur opaque lié à la conversation et refuser un curseur d'une autre conversation.
- [x] Les tests PostgreSQL de concurrence et d'immutabilité sont validés par la CI cumulative #327.
- [x] Commit local `ca9a053 feat(phase9): implement immutable messaging` dans la branche empilée PR #119 ; les preuves PostgreSQL/E2E restent à rejouer.

### Task 5: Ajouter blocage, suspension interne et anti-abus durable — IMPLÉMENTÉE, CI EN ATTENTE

**Files:**
- Create: `src/messaging/abuse.service.ts`
- Create: `src/messaging/block.service.ts`
- Modify: `src/messaging/messaging.module.ts`
- Test: `tests/phase9-messaging.abuse.test.ts`
- Test: `tests/e2e/phase9-messaging.e2e.test.ts`

**Interfaces:**
- `AbuseService.reserve(tx, dimensions, canonicalBody): Promise<AbuseDecision>` avec compteurs acteur/organisation/relation et fingerprint HMAC.
- `BlockService.block(actor, conversationId, reason, idempotencyKey)` et `unblock(...)` pour OWNER/ADMIN.

- [x] Implémenter fenêtre de 60 secondes, limites 20/200/100, intervalle d'une seconde et répétition maximale de 3 empreintes/60 secondes.
- [x] Verrouiller les buckets avant décision et incrémenter `attemptCount`/`rejectedCount` pour un `429` ; committer cette preuve et l'audit avant de lancer `TooManyRequestsException`, sans produire ni `Message` ni `message.sent`.
- [x] Persister l'audit et `messaging.abuse.threshold_exceeded.v1` dans la transaction de refus, avec `Retry-After` calculé et contenu absent.
- [x] Implémenter blocage unilatéral effectif dans les deux directions pour invitations et envois, sans supprimer l'historique déjà autorisé.
- [x] Ne publier aucune route tenant pour suspendre/réactiver/fermer ; prévoir seulement la commande interne de modération avec audit et événements `suspended/resumed`.
- [x] Les tests DB/E2E de rafales, rollback et absence d'événement fantôme sont validés par la CI cumulative #327.

### Task 6: Brancher audit, Outbox et consumers idempotents — IMPLÉMENTÉE, CI EN ATTENTE

**Files:**
- Create: `src/messaging/messaging.events.ts`
- Create: `src/messaging/messaging.audit.ts`
- Modify: `src/events/event-dispatcher.ts`
- Test: `tests/phase9-messaging.events.test.ts`

- [x] Produire les événements versionnés de conversation, invitations, participants, messages, blocage, suspension et dépassement.
- [x] Exclure le corps des messages, curseurs, tokens et secrets de chaque payload et audit.
- [x] Insérer état, audit et Outbox dans la même transaction pour chaque mutation acceptée ou refusée nécessitant une preuve.
- [x] Rendre les consumers idempotents par `eventId` ; la preuve de rejeu reste une gate PostgreSQL CI.
- [x] Tester rollback métier ⇒ aucune ligne d'audit/Outbox, et refus `429` ⇒ uniquement preuve anti-abus ; validation observée dans la CI cumulative #327.
- [x] Versionner l'implémentation dans la branche empilée PR #119.

### Task 7: Aligner runtime et contrat OpenAPI — IMPLÉMENTÉE, CI EN ATTENTE

**Files:**
- Modify: `openapi/openapi.yaml`
- Modify: `scripts/validate-contracts.mjs` si nécessaire pour les DTO Messaging
- Test: `tests/phase9-messaging.contracts.test.ts`

- [x] Conserver les 177 opérations actuellement valides et vérifier chaque surface Messaging dans le contrat.
- [x] Ajouter les schémas détaillés `Conversation`, `Message`, `ConversationInvitation`, pages, commandes, statuts et `TooManyRequests`.
- [x] Décrire `POST .../conversation-invitations/{id}/token` sans exposer le token dans les schémas de liste, ainsi que `PUT /platform/organizations/{id}/network-trust` et ses erreurs.
- [x] Vérifier que les headers `Idempotency-Key`, `Retry-After`, les curseurs et les erreurs sont cohérents avec les services.
- [x] Les assertions PostgreSQL sur le trigger et le rejeu sans quota sont validées par la CI cumulative #327.
- [x] Vérifier l'absence d'ORM brut dans les réponses et l'absence de champs auteur/source fournis par le client.
- [x] Exécuter `npm run openapi:validate` et `npm run contracts:validate`.
- [x] Versionner les validations dans la branche empilée PR #119.

### Task 8: Preuves migrations, non-régression et clôture de phase

**Files:**
- Create: `scripts/verify-phase9-migrations.mjs`
- Create: `Docs/88_PHASE_9_EXECUTION_EVIDENCE.md`
- Modify: `Docs/87_PHASE_9_STATUS.md`
- Modify: `.github/workflows/backend-ci.yml`
- Test: `tests/e2e/phase9-messaging.e2e.test.ts`

- [x] Prouver les migrations depuis une base vide et depuis la baseline Phase 8, avec contraintes SQL présentes : script et étape CI versionnés, validation observée dans la CI cumulative #327.
- [x] Ajouter les tests PostgreSQL, E2E, sécurité, isolation et non-régression des Phases 0 à 8 dans les commandes CI existantes.
- [x] Exécuter lint, typecheck, build, `npm test`, `npm run test:e2e`, OpenAPI, contrats, Prisma et toutes les preuves de migration : validation complète observée dans la CI cumulative #327.
- [x] Documenter l'état testé, les commandes, les résultats, les limites et l'absence de fonctionnalités hors MVP dans `Docs/88_PHASE_9_EXECUTION_EVIDENCE.md`.
- [ ] Marquer les gates du statut uniquement après preuves CI PR et post-fusion.
- [ ] Committer `docs(phase9): record messaging evidence` puis fusionner par PR squash et supprimer la branche.

## Ordre et dépendances

Tasks 1 et 2 précèdent 3. Task 3 précède 4 et 5. Task 6 accompagne chaque mutation avant la clôture de 4/5. Task 7 est gelée avant toute implémentation de controller ; Task 8 est la gate finale. Chaque tâche doit rester reviewable et testable indépendamment.

