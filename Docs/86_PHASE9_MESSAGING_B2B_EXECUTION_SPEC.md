# Phase 9 — Messaging B2B : spécification normative

**Statut :** cadrage proposé, avant migration et implémentation  
**Baseline :** `main@1c15d2c014d1e9eb19ecb7e71ee1c375f943c38f`  
**Périmètre :** conversations REST privées entre deux organisations, messages texte immuables, anti-abus persistant et événements Outbox.

Ce document fige les décisions de Phase 9. Il ne vaut pas validation d'une obligation fiscale, comptable ou réglementaire. Toute règle de conformité externe devra être ajoutée après validation de sa source et de son périmètre.

## 1. Objectif et frontières

Phase 9 livre un canal de communication B2B tenant-scoped et API-first :

- une conversation relie exactement deux organisations distinctes ;
- les utilisateurs sont des participants explicites, séparés des organisations ;
- les messages sont textuels, immuables et attribués à l'utilisateur et à son organisation source ;
- l'accès est REST, transactionnel et contrôlé par `AuthorizationService` ;
- les mutations critiques écrivent l'état, l'audit et l'Outbox dans la même transaction PostgreSQL.

Ne sont pas implémentés en Phase 9 : conversations de groupe, plus de deux organisations par conversation, WebSocket, pièces jointes, édition/suppression de messages, recherche plein texte, chiffrement applicatif de contenu ou fonctionnalités IA. Le modèle doit permettre une extension ultérieure sans introduire ces mécanismes maintenant.

Les invariants des Phases 0 à 8 restent prioritaires. Aucune modification silencieuse de leurs migrations, contrats ou règles métier n'est autorisée.

## 2. Dépendance Network et vérification des organisations

### 2.1 Relation Network unique

La relation inter-organisations est exclusivement la relation Network existante : une `ConnectionRequest` dont le statut est `ACCEPTED`, dans l'une ou l'autre direction. Phase 9 ne crée ni table ni service concurrent de relation commerciale.

Avant création d'une conversation et avant chaque nouvel envoi, le serveur doit vérifier :

1. les deux organisations sont distinctes et `ACTIVE` ;
2. leurs profils et entitlements permettent le module `MESSAGING` ;
3. une `ConnectionRequest` entre elles est `ACCEPTED` ;
4. leur `NetworkTrust.verificationStatus` est `VERIFIED` et, si une date existe, la vérification n'est pas expirée ;
5. aucune politique Messaging active ne bloque la relation.

La revalidation à chaque envoi empêche qu'un changement de relation ou de confiance ne soit contourné par une conversation déjà créée. La perte de la relation bloque les nouveaux envois et les nouvelles adhésions, mais ne supprime pas automatiquement l'historique déjà autorisé.

### 2.2 Écart actuel à traiter explicitement

`Docs/11_NETWORK_AND_MESSAGING.md` prévoit une organisation source vérifiée pour les interactions Network. L'implémentation actuelle de `ConnectionService` et `InquiryService` vérifie principalement le profil public, le statut de l'organisation et les entitlements ; elle ne constitue pas encore une preuve suffisante de `NetworkVerificationStatus.VERIFIED` avec expiration.

Phase 9 doit donc centraliser une policy de vérification réutilisable dans le chemin Messaging et ajouter des tests de refus `UNVERIFIED`/`EXPIRED`. Cette correction de policy ne crée pas une seconde relation et ne modifie pas rétroactivement la sémantique des connexions déjà livrées. L'écart Network doit rester documenté comme réserve à traiter dans le backlog si une harmonisation globale est décidée.

La rupture post-acceptation n'est pas représentée par un statut existant : `ConnectionRequestStatus` ne contient que `PENDING`, `ACCEPTED`, `DECLINED` et `CANCELLED`, et l'API actuelle ne propose pas de révocation d'une connexion acceptée. Phase 9 utilise donc une policy Messaging de blocage/révocation comme surcouche explicite. Elle ne détourne pas `ConnectionRequest` et ne prétend pas implémenter une nouvelle transition Network.

## 3. Modèle métier normatif

### 3.1 Conversation

Une `Conversation` contient deux organisations canoniques `organizationLowId` et `organizationHighId`, ordonnées par UUID. Une contrainte unique empêche deux conversations pour la même paire. Elle possède au minimum :

- `id`, `status` (`OPEN`, `SUSPENDED`, `CLOSED`) et timestamps ;
- les deux identifiants d'organisation canoniques ;
- un compteur `lastMessageSequence` monotone, géré sous verrou PostgreSQL ;
- l'acteur et le contexte de création pour l'audit.

La conversation est créée ouverte seulement si la policy Network/Messaging est satisfaite. `SUSPENDED` bloque les envois et les nouvelles adhésions ; les participants actifs peuvent encore lire l'historique sauf suspension de leur organisation, révocation individuelle ou blocage de sécurité. `CLOSED` est terminal pour les écritures et les adhésions ; l'historique reste soumis aux mêmes contrôles de lecture.

### 3.2 Participants organisationnels et utilisateurs

Deux lignes `ConversationOrganizationParticipant` représentent les deux organisations, avec éventuellement un `establishmentId` de rattachement pour chacune. Elles ne donnent pas, à elles seules, accès à l'historique.

Les utilisateurs sont représentés par `ConversationUserParticipant` :

- `conversationId`, `organizationId`, `userId` ;
- `ACTIVE`, `LEFT` ou `REVOKED` ;
- dates `joinedAt`, `leftAt`, `revokedAt` et acteur de la mutation ;
- unicité d'un utilisateur par conversation.

Le créateur est ajouté automatiquement pour son organisation. Un utilisateur de l'autre organisation rejoint explicitement via l'action `participants/me`, ou est ajouté par un administrateur de son organisation. L'appartenance à une organisation n'ajoute jamais automatiquement l'utilisateur à toutes ses conversations.

Un départ volontaire (`LEFT`) est réversible par une nouvelle adhésion explicite si la policy le permet. Une révocation administrative (`REVOKED`) interdit la réadhésion tant qu'un administrateur de la même organisation ne l'a pas réautorisée. Les messages déjà écrits ne changent jamais d'auteur ni d'organisation source.

### 3.3 Messages

Un `Message` contient :

- `id`, `conversationId` et `sequence` `BIGINT` strictement croissante ;
- `authorUserId` et `sourceOrganizationId`, dérivés exclusivement de la session et du participant actif ;
- `clientMessageId` opaque, borné et fourni par le client ;
- `body` texte non vide, borné par le contrat ;
- `createdAt` UTC.

Il n'existe aucune mutation d'édition ou de suppression en MVP. Une correction métier est un nouveau message explicatif, jamais une réécriture.

L'idempotence est garantie par `(conversationId, authorUserId, clientMessageId)` :

- même clé et même commande canonique : retourner le message existant ;
- même clé et commande différente : `409 Conflict`, sans mutation ;
- acteur différent ou conversation différente : aucune réutilisation ni divulgation.

L'envoi verrouille la conversation, revalide l'autorisation et attribue la prochaine séquence dans la même transaction. La contrainte unique `(conversationId, sequence)` protège contre les courses concurrentes.

La pagination utilise un curseur opaque lié à la conversation, à la direction et à la requête. L'ordre est `sequence ASC` ou `DESC` déterministe, avec une limite serveur bornée. Un curseur d'une autre conversation ou d'un autre contexte est refusé sans révéler de données.

## 4. Autorisation et matrice d'accès

Chaque requête suit le pipeline existant : identité authentifiée → organisation active → membership `ACTIVE` → entitlement `MESSAGING` autorisé → module actif → permission centralisée → scope établissement → participation explicite → policy Network/Messaging.

Phase 9 ajoute les permissions centralisées suivantes :

- `messaging:read` : lire une conversation et ses messages ;
- `messaging:write` : créer une conversation ou envoyer un message ;
- `messaging:participants:write` : ajouter/révoquer un participant de sa propre organisation ;
- `messaging:block:write` : bloquer ou débloquer une relation pour son organisation ; réservé à `OWNER` et `ADMIN`.

Matrice minimale :

| Action | OWNER/ADMIN | SALES | FINANCE | OPERATIONS | VIEWER |
|---|---:|---:|---:|---:|---:|
| Lire son historique autorisé | oui | oui | oui | oui | oui |
| Envoyer | oui | oui | oui | oui | non |
| Ajouter/révoquer ses utilisateurs | oui | non | non | non | non |
| Quitter soi-même | oui | oui | oui | oui | oui |
| Bloquer/débloquer la relation | oui | non | non | non | non |

Le rôle ne remplace jamais la participation utilisateur. Pour une ligne organisationnelle rattachée à un établissement, l'acteur doit satisfaire `assertEstablishment` pour cet établissement. Une participation organisationnelle sans établissement reste organisationnelle, mais l'utilisateur doit toujours être un participant explicite. Un acteur non participant reçoit `404` sur les ressources de conversation afin de réduire l'oracle d'existence ; les refus de permission sur une ressource déjà connue suivent les réponses API normalisées.

Lecture et envoi sont volontairement séparés :

- la lecture de l'historique reste possible pour un participant actif lorsque la relation Network est rompue, sauf suspension/révocation/blocage applicable ;
- l'envoi exige à nouveau une connexion `ACCEPTED`, la vérification des deux organisations, l'absence de blocage, la conversation `OPEN`, l'entitlement, la permission et le scope ;
- une organisation suspendue, un utilisateur suspendu ou une participation révoquée n'a ni lecture ni envoi.

## 5. Blocage et anti-abus persistant

Le blocage est une policy, pas une relation Network. `MessagingOrganizationBlock` identifie une paire canonique d'organisations, l'organisation qui bloque, l'acteur, la raison contrôlée, les timestamps et l'état actif. Un blocage actif :

- interdit les nouvelles adhésions et les nouveaux messages dans les deux directions ;
- ne détruit ni ne modifie les messages historiques ;
- est audité et produit un événement ;
- ne peut être levé que par un administrateur de l'organisation qui l'a posé ou par une action plateforme explicitement autorisée.

Les limites sont persistantes et vérifiées sous verrou dans la transaction d'envoi. Elles couvrent au minimum :

- acteur : 20 messages par minute et un intervalle minimal de 1 seconde ;
- organisation : 200 messages par minute ;
- relation : 100 messages par minute ;
- répétition du même contenu canonique par acteur et relation dans une fenêtre courte : refus anti-spam.

Ces valeurs sont des defaults de produit, configurables côté serveur sans faire varier le contrat d'autorisation. Les compteurs sont durables en PostgreSQL, séparés par dimension, avec fenêtre explicite, `blockedUntil` et audit du dépassement. Un dépassement renvoie `429` avec une indication de retry compatible, sans exposer les compteurs d'un autre tenant.

Les tentatives de spam, les blocages, déblocages, suspensions et dépassements sont auditables. Le contenu privé n'est pas copié dans l'audit ni dans l'Outbox.

## 6. API REST et contrats OpenAPI

Toutes les routes sont sous `/organizations/{organizationId}/conversations` et utilisent l'authentification existante. Les réponses ne renvoient que des DTO versionnés, jamais des entités ORM.

Routes normatives :

| Méthode | Route | Règle |
|---|---|---|
| `GET` | `/organizations/{organizationId}/conversations` | liste des conversations dont l'utilisateur est participant actif |
| `POST` | `/organizations/{organizationId}/conversations` | crée une conversation avec `targetOrganizationId` et contexte d'établissement optionnel |
| `GET` | `/organizations/{organizationId}/conversations/{conversationId}` | détail si participation autorisée |
| `GET` | `/.../{conversationId}/messages` | pagination stable des messages |
| `POST` | `/.../{conversationId}/messages` | envoi idempotent avec `clientMessageId` |
| `POST` | `/.../{conversationId}/participants/me` | adhésion explicite de l'utilisateur courant |
| `POST` | `/.../{conversationId}/participants` | ajout d'un utilisateur de sa propre organisation par OWNER/ADMIN |
| `DELETE` | `/.../{conversationId}/participants/{userId}` | départ de soi ou révocation d'un utilisateur de sa propre organisation |
| `POST` | `/.../{conversationId}/block` | blocage relationnel par OWNER/ADMIN |
| `DELETE` | `/.../{conversationId}/block` | déblocage autorisé |

Les schémas OpenAPI doivent définir les corps, réponses `200/201/204`, erreurs `400/401/403/404/409/410/429`, curseurs, limites, `clientMessageId`, `sequence`, statuts et exemples non sensibles. Le contrat doit aussi documenter la sémantique d'idempotence et le fait qu'un `404` peut masquer une ressource existante non accessible.

La commande `POST message` ne prend jamais `authorUserId`, `sourceOrganizationId` ni `sequence` du client. La commande de participant ne permet d'ajouter qu'un utilisateur dont le membership appartient à l'organisation de l'acteur ; aucune élévation cross-tenant n'est possible.

## 7. Événements, audit et Outbox

Les mutations suivantes sont atomiques avec leur audit et leur événement Outbox :

- `messaging.conversation.created.v1` ;
- `messaging.conversation.suspended.v1` et `closed.v1` ;
- `messaging.participant.joined.v1`, `left.v1`, `revoked.v1` ;
- `messaging.message.sent.v1` ;
- `messaging.relation.blocked.v1` et `unblocked.v1` ;
- `messaging.abuse.threshold_exceeded.v1`.

Les payloads sont versionnés, rejouables et minimisés : identifiants de conversation, organisations, utilisateur concerné, séquence, statut, raison contrôlée et timestamps. Le corps du message, les curseurs et les secrets ne figurent ni dans l'Outbox ni dans l'audit. La classification minimale est `CONFIDENTIAL` et l'accès aux événements suit les règles Event Fabric existantes.

Chaque consumer doit être idempotent par `eventId`. Le rejeu d'un événement ne doit pas recréer un participant, un blocage, un audit ou un effet secondaire. Un échec asynchrone reste visible par les métriques et la table Outbox ; l'état métier transactionnel ne dépend pas d'un consumer synchrone.

## 8. Concurrence, cohérence et isolation

Les contraintes PostgreSQL sont l'autorité finale :

- paire canonique unique pour une conversation ;
- exactement deux organisations participantes ;
- unicité participant utilisateur/conversation ;
- séquence et clé idempotente de message uniques ;
- une policy de blocage active par paire et organisation bloqueuse ;
- compteurs anti-abus verrouillés par dimension.

Toutes les opérations mutantes revalident les memberships, entitlements, scopes, relation et policies dans la transaction. Un conflit de contrainte est traduit en réponse API déterministe. Aucun cache ne peut accorder un accès après suspension, révocation ou blocage.

Les requêtes sont systématiquement filtrées par organisation autorisée et participation utilisateur. Une organisation ne peut lire ni compter les conversations, participants, messages, compteurs ou événements d'une autre organisation sans relation et autorisation explicites.

## 9. Migration, compatibilité et preuves obligatoires

La migration Phase 9 doit être prouvée :

1. depuis une base vide, avec toutes les migrations 0 à 9 appliquées ;
2. depuis la baseline Phase 8, sans perte ni mutation des données existantes ;
3. sur PostgreSQL réel, avec contraintes et index réellement présents ;
4. avec rollback logique des erreurs transactionnelles et absence d'effets Outbox fantômes.

Les tests obligatoires couvrent :

- isolation entre deux organisations et accès hors participant ;
- membre actif sans participation refusé ;
- scope établissement `ALL`/`SELECTED` et établissement non autorisé ;
- `UNVERIFIED`/`EXPIRED`, connexion non `ACCEPTED`, organisation suspendue ;
- blocage, déblocage, rupture Network et révocation ;
- historique lisible selon la policy mais nouvel envoi refusé ;
- auteur et organisation source toujours dérivés du contexte ;
- rejeu identique idempotent et rejeu divergent `409` ;
- clientMessageId réutilisé par un autre acteur sans fuite ;
- deux envois concurrents avec séquences distinctes ;
- deux créations concurrentes d'une même paire ;
- limites acteur/organisation/relation, rafale et spam ;
- Outbox/audit atomiques et consumers rejouables ;
- routes HTTP réelles avec `401/403/404/409/429` ;
- validation OpenAPI, lint, typecheck, build, E2E et non-régression Phases 0 à 8.

Aucune phase ne sera déclarée livrée avant publication d'une preuve versionnée listant les commandes, le commit testé, les résultats et les limites connues.

## 10. Décisions reportées explicitement

Les sujets suivants restent hors Phase 9 et ne doivent pas apparaître implicitement dans les migrations ou contrats : groupes, présence temps réel, pièces jointes, recherche, traduction, modération IA, chiffrement de bout en bout, federation de fournisseurs et nouvelle transition de statut Network post-acceptation. Leur besoin éventuel devra produire une nouvelle décision architecturale et une migration dédiée.

