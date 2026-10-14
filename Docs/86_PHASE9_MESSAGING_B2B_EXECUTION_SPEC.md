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
4. l'organisation émettrice de l'action possède `NetworkTrust.verificationStatus = VERIFIED` et, si une date existe, la vérification n'est pas expirée ;
5. l'organisation destinataire est `ACTIVE`, dispose du profil réseau et de l'entitlement `MESSAGING` ;
6. aucune politique Messaging active ne bloque la relation.

La revalidation à chaque envoi empêche qu'un changement de relation ou de confiance ne soit contourné par une conversation déjà créée. La perte de la relation bloque les nouveaux envois et les nouvelles adhésions, mais ne supprime pas automatiquement l'historique déjà autorisé. La réception ne requiert pas que l'organisation destinataire soit déjà vérifiée : elle peut accepter l'invitation et lire ce qui lui est explicitement accessible ; elle ne peut émettre qu'après sa propre vérification.

### 2.2 Écart actuel à traiter explicitement

`Docs/11_NETWORK_AND_MESSAGING.md` prévoit une organisation source vérifiée pour les interactions Network. L'implémentation actuelle de `ConnectionService` et `InquiryService` vérifie principalement le profil public, le statut de l'organisation et les entitlements ; elle ne constitue pas encore une preuve suffisante de `NetworkVerificationStatus.VERIFIED` avec expiration.

Phase 9 doit donc centraliser une policy de vérification réutilisable dans le chemin Messaging et ajouter des tests de refus de l'émetteur `UNVERIFIED`/`EXPIRED`. Le mécanisme opérationnel est la donnée de confiance gérée et auditée par le Control Plane ; Phase 9 ne crée pas de workflow de vérification ni de justificatifs. Une organisation n'est pas rendue vérifiée par la création d'une conversation. Si le Control Plane n'a pas produit un statut `VERIFIED` valide, l'envoi est refusé avec `403` et l'opérateur doit suivre le processus de vérification existant. Cette correction de policy ne crée pas une seconde relation et ne modifie pas rétroactivement la sémantique des connexions déjà livrées.

La rupture post-acceptation n'est pas représentée par un statut existant : `ConnectionRequestStatus` ne contient que `PENDING`, `ACCEPTED`, `DECLINED` et `CANCELLED`, et l'API actuelle ne propose pas de révocation d'une connexion acceptée. Phase 9 utilise donc une policy Messaging de blocage/révocation comme surcouche explicite. Elle ne détourne pas `ConnectionRequest` et ne prétend pas implémenter une nouvelle transition Network.

## 3. Modèle métier normatif

### 3.1 Conversation

Une `Conversation` contient deux organisations canoniques `organizationLowId` et `organizationHighId`, ordonnées par UUID. Une contrainte unique empêche deux conversations pour la même paire. Elle possède au minimum :

- `id`, `status` (`OPEN`, `SUSPENDED`) et timestamps ;
- les deux identifiants d'organisation canoniques ;
- un compteur `lastMessageSequence` monotone, géré sous verrou PostgreSQL ;
- l'acteur et le contexte de création pour l'audit.

La conversation est créée ouverte seulement si la policy Network/Messaging est satisfaite. `SUSPENDED` bloque les envois et les nouvelles adhésions ; les participants actifs peuvent encore lire l'historique sauf suspension de leur organisation, révocation individuelle ou blocage de sécurité. La suspension est réversible. Le MVP ne propose ni fermeture terminale ni commande publique de fermeture : la contrainte d'une conversation unique par paire est ainsi compatible avec la reprise contrôlée des échanges. Une future politique d'archivage devra définir une génération de conversation ou une règle de réouverture avant d'ajouter une fermeture.

### 3.2 Participants organisationnels et utilisateurs

Deux lignes `ConversationOrganizationParticipant` représentent les deux organisations, avec éventuellement un `establishmentId` de rattachement pour chacune. Elles ne donnent pas, à elles seules, accès à l'historique.

Les utilisateurs sont représentés par `ConversationUserParticipant` :

- `conversationId`, `organizationId`, `userId` ;
- `ACTIVE`, `LEFT` ou `REVOKED` ;
- dates `joinedAt`, `leftAt`, `revokedAt`, acteur de la mutation et `historyVisibleFromSequence` ;
- unicité d'un utilisateur par conversation.

Le créateur est ajouté automatiquement pour son organisation. La création produit une invitation organisationnelle `PENDING` pour l'autre organisation, sans contenu de message. Seul un `OWNER` ou `ADMIN` actif du destinataire peut la consulter dans sa boîte d'invitations, l'accepter ou la refuser. Après acceptation organisationnelle, un `OWNER` ou `ADMIN` invite un ou plusieurs utilisateurs déterminés de sa propre organisation ; chaque utilisateur accepte explicitement sa propre invitation avant de devenir participant. L'appartenance à une organisation, la connaissance d'un UUID ou l'accès à une boîte d'invitations ne suffit donc jamais à rejoindre ni à lire une conversation.

Un départ volontaire (`LEFT`) est réversible par une nouvelle invitation et acceptation explicites si la policy le permet. Une révocation administrative (`REVOKED`) interdit la réadhésion tant qu'un administrateur de la même organisation ne l'a pas réautorisée. Toute nouvelle adhésion fixe `historyVisibleFromSequence` à la séquence suivante : aucune lecture rétroactive n'est accordée par une réadhésion. Les messages déjà écrits ne changent jamais d'auteur ni d'organisation source.

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

- avant l'acceptation de l'invitation organisationnelle, le destinataire ne voit que les métadonnées minimales de l'invitation ; il ne voit aucun message ;
- après acceptation organisationnelle mais avant acceptation d'une invitation utilisateur, aucun utilisateur du destinataire ne voit l'historique ;
- après adhésion, un utilisateur lit seulement les messages dont la séquence est supérieure ou égale à son `historyVisibleFromSequence` ;
- un départ ou une révocation retire immédiatement la lecture et l'envoi ; une réadhésion exige une nouvelle invitation et recommence à la séquence courante ;
- un blocage ou une rupture Network interdit les nouvelles invitations et les nouveaux envois, mais ne supprime pas automatiquement l'historique déjà autorisé d'un participant encore actif ;
- une suspension de conversation conserve la lecture des participants actifs, sans autoriser d'envoi ou d'adhésion ; une suspension d'organisation, d'utilisateur ou de participant interdit aussi la lecture ;
- l'envoi exige une connexion `ACCEPTED`, un émetteur vérifié, une cible active, au moins un participant actif dans chaque organisation, l'absence de blocage, la conversation `OPEN`, l'entitlement, la permission et le scope ;
- une organisation suspendue, un utilisateur suspendu ou une participation révoquée n'a ni lecture ni envoi.

## 5. Blocage et anti-abus persistant

Le blocage est une policy, pas une relation Network. `MessagingOrganizationBlock` identifie une paire canonique d'organisations, l'organisation qui bloque, l'acteur, la raison contrôlée, les timestamps et l'état actif. Un blocage actif :

- interdit les nouvelles adhésions et les nouveaux messages dans les deux directions ;
- ne détruit ni ne modifie les messages historiques ;
- est audité et produit un événement ;
- ne peut être levé que par un administrateur de l'organisation qui l'a posé ou par une action plateforme explicitement autorisée.

Les limites sont persistantes et vérifiées sous verrou dans la transaction d'envoi. Elles couvrent exactement les règles MVP suivantes :

- acteur : 20 tentatives valides par fenêtre glissante de 60 secondes et un intervalle minimal de 1 seconde entre deux acceptations ;
- organisation : 200 tentatives valides par fenêtre glissante de 60 secondes ;
- relation : 100 tentatives valides par fenêtre glissante de 60 secondes ;
- répétition : au maximum 3 empreintes identiques par acteur et relation sur 60 secondes, puis refus `429` jusqu'à la fin de la fenêtre de répétition.

Les compteurs sont durables en PostgreSQL, séparés par dimension, avec fenêtre explicite, `attemptCount`, `acceptedCount`, `rejectedCount`, `blockedUntil` et empreinte HMAC du contenu canonique lorsqu'elle est nécessaire à la règle de répétition. La transaction verrouille et incrémente les compteurs avant de décider. Une commande rejetée avec `429` persiste donc son dépassement et son audit, mais ne crée ni `Message` ni `messaging.message.sent.v1`. Les limites peuvent être configurées côté serveur uniquement ; leur modification est auditée et ne change pas le contrat d'autorisation.

Les tentatives de spam, les blocages, déblocages, suspensions et dépassements sont auditables. Le contenu privé n'est pas copié dans l'audit ni dans l'Outbox.

## 6. API REST et contrats OpenAPI

Toutes les routes sont sous `/organizations/{organizationId}/conversations` ou sous la boîte d'invitations de l'organisation et utilisent l'authentification existante. Les réponses ne renvoient que des DTO versionnés, jamais des entités ORM.

Routes normatives :

| Méthode | Route | Règle |
|---|---|---|
| `GET` | `/organizations/{organizationId}/conversations` | liste des conversations dont l'utilisateur est participant actif |
| `POST` | `/organizations/{organizationId}/conversations` | crée une conversation avec `targetOrganizationId` et contexte d'établissement optionnel |
| `GET` | `/organizations/{organizationId}/conversations/{conversationId}` | détail si participation autorisée |
| `GET` | `/.../{conversationId}/messages` | pagination stable des messages |
| `POST` | `/.../{conversationId}/messages` | envoi idempotent avec `clientMessageId` |
| `GET` | `/organizations/{organizationId}/conversation-invitations` | boîte de métadonnées : invitations d'organisation pour OWNER/ADMIN et invitations utilisateur adressées à l'acteur |
| `POST` | `/organizations/{organizationId}/conversation-invitations/{invitationId}/accept` | accepte avec le token d'invitation ; active l'organisation ou l'utilisateur selon le type |
| `POST` | `/organizations/{organizationId}/conversation-invitations/{invitationId}/decline` | refuse l'invitation sans exposer de message |
| `POST` | `/.../{conversationId}/participant-invitations` | invite un utilisateur déterminé de sa propre organisation, par OWNER/ADMIN, après acceptation organisationnelle |
| `DELETE` | `/.../{conversationId}/participants/{userId}` | départ de soi ou révocation d'un utilisateur de sa propre organisation |
| `POST` | `/.../{conversationId}/block` | blocage relationnel par OWNER/ADMIN |
| `DELETE` | `/.../{conversationId}/block` | déblocage autorisé |

Les schémas OpenAPI doivent définir les corps, réponses `200/201/204`, erreurs `400/401/403/404/409/410/429`, curseurs, limites, `clientMessageId`, `sequence`, statuts et exemples non sensibles. Le contrat doit aussi documenter la sémantique d'idempotence, le token d'invitation à usage contrôlé et le fait qu'un `404` peut masquer une ressource existante non accessible.

La commande `POST message` ne prend jamais `authorUserId`, `sourceOrganizationId` ni `sequence` du client. La commande de participant ne permet d'ajouter qu'un utilisateur dont le membership appartient à l'organisation de l'acteur ; aucune élévation cross-tenant n'est possible.

Une acceptation d'invitation exige simultanément : membership actif, organisation ciblée correspondante, permission applicable, invitation `PENDING`, token correspondant, expiration non dépassée et policy Network/Messaging encore valide. Un UUID d'invitation seul ne permet ni adhésion ni lecture.

## 7. Événements, audit et Outbox

Les mutations suivantes sont atomiques avec leur audit et leur événement Outbox :

- `messaging.conversation.created.v1` ;
- `messaging.conversation.suspended.v1` et `resumed.v1` ;
- `messaging.organization_invitation.created.v1`, `accepted.v1`, `declined.v1` et `revoked.v1` ;
- `messaging.user_invitation.created.v1`, `accepted.v1`, `declined.v1` et `revoked.v1` ;
- `messaging.participant.joined.v1`, `left.v1`, `revoked.v1` ;
- `messaging.message.sent.v1` ;
- `messaging.relation.blocked.v1` et `unblocked.v1` ;
- `messaging.abuse.threshold_exceeded.v1` pour une tentative refusée, jamais comme événement d'envoi.

Les payloads sont versionnés, rejouables et minimisés : identifiants de conversation, organisations, utilisateur concerné, séquence, statut, raison contrôlée et timestamps. Le corps du message, les curseurs et les secrets ne figurent ni dans l'Outbox ni dans l'audit. La classification minimale est `CONFIDENTIAL` et l'accès aux événements suit les règles Event Fabric existantes.

Chaque consumer doit être idempotent par `eventId`. Le rejeu d'un événement ne doit pas recréer un participant, un blocage, un audit ou un effet secondaire. Un échec asynchrone reste visible par les métriques et la table Outbox ; l'état métier transactionnel ne dépend pas d'un consumer synchrone.

### Autorité des transitions

Le MVP ne publie aucune route permettant à un tenant de suspendre, réactiver ou fermer une conversation. La suspension et la reprise sont des commandes internes de modération/Control Plane, réservées à une autorité plateforme auditée ; elles produisent `suspended.v1` ou `resumed.v1`. Les OWNER/ADMIN peuvent seulement gérer les invitations, leurs participants et leur blocage relationnel. Une rupture de connexion ou une expiration de vérification est une condition d'autorisation calculée, pas une transition de conversation. Il n'existe pas de `CLOSED` ni d'événement de fermeture en Phase 9.

## 8. Concurrence, cohérence et isolation

Les contraintes PostgreSQL sont l'autorité finale :

- paire canonique unique pour une conversation ;
- exactement deux organisations participantes ;
- invitation organisationnelle unique par conversation et invitation utilisateur unique par utilisateur/conversation ;
- unicité participant utilisateur/conversation ;
- borne d'historique par `historyVisibleFromSequence` ;
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
- invitation d'organisation sans fuite de message, token absent/invalide, invitation refusée et expiration ;
- absence d'accès avant adhésion, après départ/révocation, et absence de lecture rétroactive après réadhésion ;
- historique lisible selon la policy mais nouvel envoi refusé ;
- auteur et organisation source toujours dérivés du contexte ;
- rejeu identique idempotent et rejeu divergent `409` ;
- clientMessageId réutilisé par un autre acteur sans fuite ;
- deux envois concurrents avec séquences distinctes ;
- deux créations concurrentes d'une même paire ;
- limites acteur/organisation/relation, rafale et spam, y compris persistance d'une tentative `429` sans message ni événement fantôme ;
- Outbox/audit atomiques et consumers rejouables ;
- routes HTTP réelles avec `401/403/404/409/429` ;
- validation OpenAPI, lint, typecheck, build, E2E et non-régression Phases 0 à 8.

Aucune phase ne sera déclarée livrée avant publication d'une preuve versionnée listant les commandes, le commit testé, les résultats et les limites connues.

## 10. Décisions reportées explicitement

Les sujets suivants restent hors Phase 9 et ne doivent pas apparaître implicitement dans les migrations ou contrats : groupes, présence temps réel, pièces jointes, recherche, traduction, modération IA, chiffrement de bout en bout, federation de fournisseurs, fermeture de conversation et nouvelle transition de statut Network post-acceptation. Leur besoin éventuel devra produire une nouvelle décision architecturale et une migration dédiée.

