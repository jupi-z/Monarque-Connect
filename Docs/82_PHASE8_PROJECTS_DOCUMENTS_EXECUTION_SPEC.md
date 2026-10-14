# 82 — Spécification d'exécution Phase 8 — Projects & Documents

## 1. Objet et baseline

Cette spécification ouvre la Phase 8 — Projects & Documents sur la baseline
`main@f3d550beb94e4e95eb6563eeece29c1d4249b4c8`, après la clôture prouvée de
la Phase 7. Le suivi GitHub est l'issue #105.

Le périmètre est :

`Project → Task → Document/Media links`.

La phase reste API-first, tenant-scoped, establishment-scoped lorsque la
ressource l'exige, autorisée par les services centraux, idempotente pour les
mutations rejouables, auditable et compatible avec les Phases 0 à 7.

Cette phase ne crée pas de moteur de stockage propriétaire, de recherche
full-text, de workflow de signature, de collaboration temps réel ni de règle
fiscale ou réglementaire.

## 2. Frontières métier

### 2.1 Project

Un Project est une unité de travail opérationnelle appartenant à une
organization et obligatoirement rattachée à un establishment actif. Il peut
référencer une `BusinessParty` cliente et/ou une `Opportunity` du même tenant.
Ces références sont des liens vérifiés côté serveur ; elles ne copient pas les
agrégats CRM.

Champs normatifs : `id`, `organizationId`, `establishmentId`, `name`,
`description?`, `partyId?`, `opportunityId?`, `startsOn?`, `dueOn?`, `status`,
`createdByUserId`, `createdAt`, `updatedAt`, `completedAt?`, `cancelledAt?`.

Statuts :

`PLANNED → ACTIVE → COMPLETED | CANCELLED`.

Un Project `COMPLETED` ou `CANCELLED` est immuable sauf correction
administrative explicitement auditée. Une transition est une commande métier,
jamais une modification libre du champ `status`. `dueOn` ne peut pas précéder
`startsOn` lorsqu'ils sont tous les deux présents.

### 2.2 Task

Une Task appartient à exactement un Project et hérite de son organization et
de son establishment. Son responsable est un membership actif du même tenant
et doit être compatible avec le scope établissement du Project.

Champs normatifs : `id`, `organizationId`, `projectId`, `title`,
`description?`, `assigneeUserId?`, `dueOn?`, `status`, `position`,
`createdByUserId`, `createdAt`, `updatedAt`, `completedAt?`, `cancelledAt?`.

Statuts :

`TODO → IN_PROGRESS → DONE | CANCELLED`.

Une Task `DONE` ou `CANCELLED` ne revient pas silencieusement à un état ouvert.
Une correction autorisée utilise une commande de transition explicite, garde
la trace de l'état précédent et produit un audit. La suppression physique des
Tasks n'est pas autorisée dans le périmètre initial.

### 2.3 Document et Media

Un Document est une métadonnée métier et une référence vers un objet binaire
géré par un adaptateur de stockage. Les octets ne sont pas stockés dans
PostgreSQL et aucun client n'accède directement à PostgreSQL ou au fournisseur
de stockage.

Champs normatifs : `id`, `organizationId`, `establishmentId?`,
`originalFilename`, `mediaType`, `byteSize`, `checksumSha256?`, `storageKey?`,
`status`, `classification`, `uploadedByUserId`, `createdAt`, `updatedAt`,
`revokedAt?`, `revocationReason?`.

Statuts : `PENDING_UPLOAD → AVAILABLE | QUARANTINED | REVOKED`.

`storageKey` est opaque, non devinable et ne constitue jamais une URL publique.
Un Document `AVAILABLE` est immuable pour son identité binaire : une nouvelle
version sera une nouvelle décision d'architecture et n'est pas implémentée
dans cette phase. `REVOKED` est terminal et conserve ses métadonnées d'audit.

`classification` utilise `INTERNAL | CONFIDENTIAL | RESTRICTED`. Le serveur
applique une politique minimale : un document ne peut pas être lu par un
acteur qui ne pourrait pas lire sa cible métier.

### 2.4 DocumentLink

`DocumentLink` relie un Document à une cible autorisée sans polymorphisme SQL
non contrôlé. La paire `(organizationId, documentId, targetType, targetId)` est
unique.

Les cibles initiales sont : `PROJECT`, `TASK`, `OPPORTUNITY`, `PARTY`,
`QUOTE`, `SALES_ORDER`, `INVOICE`, `PAYMENT_RECORD`, `SUPPLIER_RFQ`,
`PURCHASE_ORDER`, `GOODS_RECEIPT`, `EXPENSE`.

Chaque cible est résolue dans le tenant de la route et, lorsqu'elle est
établissement-scopée, son établissement doit être compatible avec celui du
Document et du membership. Un lien ne change jamais l'état de la cible. Le
retrait d'un lien est audité et idempotent ; il ne supprime pas le Document.

## 3. Règles d'autorisation

Les nouveaux endpoints réutilisent `AuthorizationService.requireModule()` et
`assertEstablishment()`. Aucun contrôleur ou service Phase 8 ne recrée une
matrice RBAC locale.

Entitlements obligatoires : `PROJECTS` pour Project/Task et `DOCUMENTS` pour
Document/DocumentLink. Toute organisation suspendue, tout module désactivé ou
toute capability absente est refusé côté serveur.

Permissions à ajouter au catalogue central avant implémentation :

| Domaine | Lecture | Écriture |
|---|---|---|
| Projects/Tasks | `projects:read` | `projects:write` |
| Documents/links | `documents:read` | `documents:write` |

Politique de rôles initiale : OWNER et ADMIN ont lecture/écriture ; OPERATIONS
et SALES ont Projects/Tasks selon leur activité et scope ; FINANCE peut lire
les Projects et les documents liés aux domaines financiers mais ne reçoit pas
`documents:write` par défaut ; VIEWER reçoit uniquement la lecture. Toute
extension de rôle doit être ajoutée à la matrice centrale et testée.

Les lectures filtrent organization, establishment et scope **avant** la
pagination, le comptage ou la résolution des liens. Un `projectId`, `taskId`,
`documentId` ou `targetId` provenant d'un autre tenant ne révèle pas son
existence et retourne la réponse de sécurité prévue par la politique HTTP
centrale.

## 4. Contrat HTTP normatif

Le contrat machine-readable est gelé dans `openapi/openapi.yaml`. Toutes les
routes sont sous `/api/v1`, utilisent `bearerAuth` et documentent les réponses
`400`, `401`, `403`, `404` et `409` avec Problem Details.

### Projects et Tasks

- `GET /organizations/{organizationId}/projects` — liste paginée, filtres
  `establishmentId` et `status`, `PROJECTS + projects:read` ;
- `POST /organizations/{organizationId}/projects` — création idempotente,
  `PROJECTS + projects:write` ;
- `GET/PATCH /organizations/{organizationId}/projects/{projectId}` — lecture
  et modification des champs éditables, sans mutation libre du statut ;
- `POST /organizations/{organizationId}/projects/{projectId}/transition` —
  transition explicite idempotente ;
- `GET /organizations/{organizationId}/projects/{projectId}/tasks` — liste
  paginée filtrée par scope ;
- `POST /organizations/{organizationId}/projects/{projectId}/tasks` — création
  idempotente ;
- `GET/PATCH /organizations/{organizationId}/tasks/{taskId}` — lecture et
  modification des champs éditables ;
- `POST /organizations/{organizationId}/tasks/{taskId}/transition` — transition
  explicite idempotente.

Les mutations exigent `Idempotency-Key`, rejouent le même résultat si la
commande canonique est identique et répondent `409` si la même clé représente
une autre commande.

### Documents et liens

- `GET /organizations/{organizationId}/documents` — liste paginée par cible,
  statut et établissement ;
- `POST /organizations/{organizationId}/documents/uploads` — initialise une
  session d'upload opaque et crée les métadonnées `PENDING_UPLOAD` ;
- `GET /organizations/{organizationId}/documents/{documentId}` — métadonnées
  et liens autorisés ;
- `POST /organizations/{organizationId}/documents/{documentId}/complete` —
  vérifie l'objet via l'adaptateur et passe à `AVAILABLE` ;
- `GET /organizations/{organizationId}/documents/{documentId}/content` — le
  backend relaie les octets après autorisation ; aucun accès direct fournisseur ;
- `POST /organizations/{organizationId}/documents/{documentId}/links` — ajoute
  un lien cible autorisé ;
- `DELETE /organizations/{organizationId}/documents/{documentId}/links/{linkId}`
  — retire un lien sans supprimer le Document ;
- `POST /organizations/{organizationId}/documents/{documentId}/revoke` — rend
  le Document indisponible de manière terminale et auditée.

Les opérations binaires sont bornées par `byteSize`, `mediaType` et les limites
de configuration ; aucun quota commercial nouveau n'est créé par cette phase.
La session d'upload expire et sa reprise est contrôlée par sa clé
d'idempotence.

## 5. Événements, audit et Outbox

Événements versionnés proposés dans le catalogue métier :

- `project.created.v1`, `project.updated.v1`, `project.status_changed.v1` ;
- `task.created.v1`, `task.updated.v1`, `task.status_changed.v1` ;
- `document.upload_started.v1`, `document.available.v1`,
  `document.linked.v1`, `document.unlinked.v1`, `document.revoked.v1`.

Chaque mutation métier écrit l'état, l'audit et l'Outbox dans la même
transaction PostgreSQL. Les consumers sont at-least-once et idempotents ; un
rejeu ne recrée ni Project/Task/Document ni DocumentLink. Les événements ne
contiennent jamais d'octets, de secrets, de tokens d'upload ou d'URL
fournisseur ; ils contiennent des identifiants, des snapshots minimaux,
classification et provenance.

## 6. Concurrence et invariants de données

- unicité des noms ou codes métier appliquée dans le tenant selon la décision
  de numérotation ; aucune numérotation commerciale n'est inventée ici ;
- transitions verrouillées sur l'agrégat Project/Task ; une transition
  obsolète retourne `409` et ne publie pas d'événement ;
- liens documentaires uniques et vérifiés dans la même transaction que leur
  audit ;
- idempotence par organization, acteur, opération et clé, avec hash canonique
  de commande ;
- toutes les références croisées vérifient organization et establishment dans
  la transaction ;
- aucun solde, ledger Inventory/Cash ou document commercial des Phases 0 à 7
  n'est recalculé ou modifié par Phase 8 ;
- les corrections sont de nouvelles commandes/audits, jamais une mise à jour
  silencieuse d'un fait historique.

## 7. Stockage et adaptateur binaire

La persistance Phase 8 sépare les métadonnées relationnelles de l'adaptateur
binaire. L'interface interne minimale sera :

`beginUpload(metadata) → { storageKey, uploadToken, expiresAt }`,
`completeUpload(storageKey, checksum, byteSize)`,
`readStream(storageKey)`, `revoke(storageKey)`.

Cette interface ne choisit aucun fournisseur. Les tests utilisent un adaptateur
mémoire/fichier contrôlé ; l'intégration d'un fournisseur, l'antivirus, l'OCR,
la preview et la rétention réglementaire sont hors périmètre.

## 8. Migrations et preuves

Les migrations seront additives depuis la baseline Phase 7 et ne modifieront
aucune migration historique. Les preuves obligatoires couvriront :

- base vide et upgrade depuis la dernière migration Phase 7 ;
- clés étrangères tenant/establishment et unicités de liens/idempotence ;
- isolation entre deux organizations et entre établissements sélectionnés ;
- transitions concurrentes Project/Task et rejeux divergents ;
- upload incomplet, completion idempotente, révocation et contenu inaccessible ;
- liens vers chaque cible autorisée et refus des cibles inter-tenant ;
- audit/Outbox atomiques et consumers rejoués ;
- OpenAPI, contrats, PostgreSQL réel, E2E HTTP, build, smoke et non-régression
  des Phases 0 à 7.

## 9. Décisions explicitement différées

Les décisions suivantes nécessitent un ADR ou une validation commerciale avant
implémentation si elles deviennent nécessaires : versioning binaire, quotas de
stockage facturés, retention/legal hold, antivirus fournisseur, OCR, signatures,
partage public, recherche full-text et collaboration temps réel.
