# C2 — Identity, Tenancy & Tenant Principals

**Statut :** contrat normatif C2.1–C2.3. C2.2 est livré sur `main@e57e5b4`; C2.3 est en implémentation sur une branche dédiée et reste soumis à sa PR et à ses CI. C2.4 n'est pas réputé livré.
**Baseline C2.1 :** `main@e34e9fa0d7c92cd0ae69a82d1b39110906fbaec3`; CI post-fusion #540 verte. C2.1 est fusionné au commit `cf80f6d251d094b02587d64a842fbf4af8c8c7ef`; CI post-fusion #542 verte. Les détails SQL C2.2 ci-dessous précèdent toute migration.
**Suivi :** issue [#163](https://github.com/jupi-z/Monarque-Connect/issues/163).
**Compatibilité :** [Docs/114](114_PHASE_10A5_BOUNDARY_INVARIANTS.md), [Docs/115](115_PHASE_10A5_C0_CODEBASE_AUDIT.md), [Docs/116](116_C1_PRODUCT_CATALOG_AND_ENTITLEMENTS_CONTRACT.md), [Docs/118](118_C1_CLOSURE_EVIDENCE.md).

## 1. But et limites

C2 a pour cible un registre d'identités externes et un contexte d'acteur distinct de l'authentification; ces capacités ne sont pas encore implémentées à la baseline. `User.id` reste l'identifiant métier canonique. Le Core continue à authentifier les sessions historiques et ne dépend ni du déploiement ni de la disponibilité de Monarque Auth/Keycloak.

C2 ne développe pas Monarque Auth, Keycloak, les applications clientes, un parcours BUYER complet, le runtime d'agents, une intégration ZAMUREK, ni les lots C3–C8. Aucun fournisseur OIDC runtime n'est considéré configuré. Une future validation OIDC ne peut être activée qu'avec un flux complet vérifiant signature, issuer exact, audience, expiration, `nbf`, algorithmes autorisés, clés et rotation, `state`, `nonce`, PKCE et URI de redirection autorisée.

## 2. Identités internes et sessions legacy

- `User.id`, `Membership.id`, les identifiants d'organisation/établissement, les références d'audit et les références financières ne sont jamais remplacés ni reconstruits.
- `AuthPrincipal { userId, sessionId }`, le JWT d'accès (`sub=User.id`, `sid=sessionId`) et les refresh sessions conservent leur format, leurs durées et leurs règles actuelles.
- Un principal authentifié prouve seulement l'identité interne de session. Il ne prouve ni membership, ni rôle, ni produit, ni établissement, ni propriété de ressource.
- Le principal STAFF n'est construit qu'après lecture serveur d'un membership actif, puis autorisation de rôle, permission, produit, établissement et ressource. L'identité d'acteur envoyée par le client est toujours ignorée pour décider les droits.
- Les événements historiques `USER` restent inchangés. La catégorie d'acteur d'autorisation est distincte de l'attribution technique historique d'un événement.

## 3. Registre d'identités externes

La relation est `ExternalIdentity(issuer, subject) → User.id`.

Le modèle additif `ExternalIdentity` contient : `id`, `userId`, `issuer`, `subject`, `status` (`ACTIVE|REVOKED`), `verifiedAt`, `createdAt`, `updatedAt`, `revokedAt`, `createdByUserId` et `revokedByUserId` nullable selon l'action. `userId` et les acteurs d'audit référencent les utilisateurs existants avec suppression restrictive. La paire issuer/subject est unique sur toutes les lignes. Aucun champ de profil ou email IdP n'est copié sur `User`.

### 3.1 Sémantique des clés

- `issuer` est l'identifiant exact de l'émetteur OIDC configuré et validé par le serveur; comparaison exacte, sensible à la casse, sans normalisation d'URL. Il doit être un URL HTTPS valide sans requête ni fragment, conformément au contrat OIDC.
- `subject` est l'identifiant opaque exact vérifié pour cet issuer; comparaison exacte et sensible à la casse. Il n'est ni dérivé ni remplacé par l'email.
- Un email, même vérifié, ne participe jamais à la résolution, fusion ou liaison automatique d'un `User`.

### 3.2 État, unicité et réattribution

- L'unicité SQL porte sur `(issuer, subject)` sans filtre de statut : une ligne révoquée demeure un tombstone de propriété et ne peut pas être transférée vers un autre utilisateur.
- Une identité active ne peut correspondre qu'à un seul `User.id`. La révocation n'efface ni la ligne ni l'historique.
- Une réactivation n'est permise que pour le même `User.id`, avec nouvelle preuve d'identité et action explicite; l'opération est atomique et auditée. Toute tentative par un autre utilisateur échoue en conflit, même après révocation.
- Les suppressions physiques d'identités externes sont interdites par le service applicatif. Les comptes utilisateurs restent désactivés via leurs états existants; l'identité n'entraîne aucune suppression en cascade.
- Les horodatages sont UTC/Timestamptz : création, vérification courante, mise à jour et révocation. L'association garde l'ID interne de l'utilisateur qui en est propriétaire et la provenance des commandes de liaison/révocation.

### 3.3 Liaison et récupération

- La liaison, la réactivation et la révocation exigent une session interne active de l'utilisateur cible et une réauthentification récente vérifiée côté serveur. Si une politique MFA est déjà activée pour ce compte, elle reste exigée; C2 ne prétend pas fournir ni activer une MFA absente. La liaison exige aussi une intention à usage unique liée à cette session et une preuve externe vérifiée pour cette intention.
- Le service ne reçoit jamais issuer/subject directement depuis un DTO client et ne consomme jamais des claims simplement décodés. Il accepte seulement un résultat typé fourni par un adaptateur de vérification de confiance, lié au `linkRequestId` et à son expiration.
- La première liaison est réservée au propriétaire du compte authentifié. Aucun rapprochement email ni recherche implicite d'un compte homonyme n'est effectué.
- La demande de liaison persistante est un `ExternalIdentityLinkChallenge` séparé, lié à `userId` et au `sessionId` legacy, avec hashes de `state`/`nonce`, expiration après 10 minutes, création et consommation atomique. `state` et `nonce` sont issus chacun d'au moins 32 octets cryptographiquement aléatoires. Les valeurs brutes ne sont pas stockées; le challenge est utilisable une seule fois et seulement si la session demeure active.
  - La création du challenge exige la vérification du mot de passe courant par `AuthService` dans la même opération applicative; la base confirme aussi que la session reste active au moment de la persistance. La preuve de réauthentification est éphémère, liée à `userId`/`sessionId` et à la version exacte du vérificateur de mot de passe observée; avant toute mutation, la transaction verrouille ou relit l'utilisateur et la session, puis refuse si le mot de passe a changé ou si la session est inactive/révoquée. Le mot de passe et son hash ne sont jamais persistés dans le challenge, l'audit ou l'Outbox. La révocation exige la même réauthentification. Une politique MFA déjà appliquée reste obligatoire, mais C2 ne déclare pas de MFA nouvelle.
- En cas de perte d'accès, un autre utilisateur ne peut pas récupérer ni réattribuer l'identité en la revendiquant. La récupération s'appuie sur le parcours historique de compte ou une procédure de récupération explicitement autorisée, vérifiée et auditée; elle ne suppose pas Monarque Auth.
- La révocation est demandée par le propriétaire authentifié et réauthentifié ou par une capacité plateforme explicite et auditée. La révocation ne coupe pas automatiquement les sessions legacy; la révocation de sessions reste une commande séparée.

## 4. Provenance et frontière d'authentification

La future interface interne `IdentityProviderPort` fournit un principal vérifié, non les droits métier. Son contrat doit inclure l'issuer et subject vérifiés, l'utilisateur interne résolu, l'instant de validation, l'identifiant de la demande liée et les garanties de validation effectivement obtenues. Les objets non vérifiés ne peuvent pas implémenter le contrat de preuve admis par le service de liaison.

Le provider optionnel est absent par défaut. Aucun appel réseau à l'IdP n'est requis au démarrage ou pendant les requêtes legacy. Aucun claim `role`, `organizationId`, `establishmentId`, `productCode`, `actorType` ou `channelId` ne donne de permission directement.

## 5. Catégories d'acteurs et décision d'accès

| Catégorie | Provenance autoritative | Autorisations C2 | Limite C2 |
|---|---|---|---|
| `STAFF` | `User` authentifié + membership actif résolu depuis la base pour chaque organisation | rôle, permission, produit, établissement, ressource et état global validés par les services existants | Pas de rôle fourni par le client; un abonnement produit ne remplace jamais les permissions |
| `BUYER` | compte/profil acheteur et propriété de ressource prouvés côté serveur | uniquement les objets appartenant au buyer ou une capability serveur liée à l'objet, expirante et révocable | Aucun membership STAFF; aucune lecture de ledger ou d'API staff; le parcours complet reste `PLANNED` |
| `AGENT` | délégation serveur bornée à un tenant/produit/action/ressource et échéance | seulement outils/policies explicitement accordés, auditables et révocables | Aucun Prisma, rôle propriétaire/admin, ni droit financier implicite; runtime reste `PLANNED` |
| `PLATFORM` | `PlatformAuthorizationService` et capacité plateforme existante/configurée | opération transversale explicitement permise, bornée et auditée | Aucun contournement général de tenant, membership, produit ou suspension globale |
| `WALK_IN` | STAFF authentifié qui exécute la vente de passage | droits STAFF et contexte du point de vente | Ce n'est pas un principal BUYER ni un compte fictif |

Règle complète d'accès : `acteur + organisation + établissement + produit + permission + ressource + contexte opérationnel`. Les identifiants fournis par le client sont des sélecteurs de cible, jamais des preuves d'appartenance ou d'autorisation.

## 6. Compatibilité produits et tenancy

- C1 reste la source de vérité : les résolveurs legacy demeurent Monarque Connect; les nouveaux appels exigent un `productCode` explicite et n'ont aucun fallback entre produits.
- Membership et scopes établissement restent globaux à l'organisation selon leur schéma existant; ils ne sont pas copiés dans un membership produit parallèle. Le droit d'opérer chaque produit reste décidé par permissions et entitlements scoppés C1.
- Une suspension globale de l'organisation bloque tous les produits; une suspension de produit demeure isolée.
- BUYER, AGENT et PLATFORM ne réutilisent pas implicitement le membership STAFF. Les éventuelles capacités partagées sont accordées par opération précise.
- Les endpoints, tokens et événements historiques des phases 0–10A restent compatibles. Aucun nouveau champ client ne peut modifier le principal authentifié.

## 7. Audit, Outbox et concurrence

Toute liaison, réactivation ou révocation persistée doit écrire l'état, l'audit et l'Outbox dans la même transaction PostgreSQL. Les actions d'audit sont `EXTERNAL_IDENTITY_LINKED`, `EXTERNAL_IDENTITY_REACTIVATED` et `EXTERNAL_IDENTITY_REVOKED`; les événements version 1 sont `identity.external_identity.linked`, `identity.external_identity.reactivated` et `identity.external_identity.revoked`. Audit et événements sont minimisés : ID de l'association, issuer et action; jamais de subject, jeton, secret, email ni claim complet. Le userId cible n'est pas copié dans `metadataJson` ni le payload Outbox générique; l'acteur utilisateur déjà porté par l'enveloppe fournit l'attribution. Le subject reste dans le registre protégé.

Les requêtes concurrentes sur la même paire `(issuer, subject)` sont arbitrées par l'unicité SQL. Le challenge est consommé par compare-and-set dans la transaction de liaison; un rejeu ne peut jamais créer de seconde transition. Une liaison vers un autre utilisateur, une preuve expirée/non liée, ou une révocation déjà incompatible échoue sans mutation partielle. Les preuves et commandes doivent avoir une portée unique, expirable et liée à une session.

### 7.1 Schéma SQL normatif C2.2

`ExternalIdentity` est stockée dans `external_identities` :

| Colonne | Type/contrainte |
|---|---|
| `id` | UUID, clé primaire |
| `user_id` | UUID NOT NULL → `users.id`, `ON DELETE RESTRICT` |
| `issuer` | VARCHAR(2048) NOT NULL, URL HTTPS ASCII sans query/fragment, `octet_length(issuer) <= 2048`, comparaison exacte |
| `subject` | VARCHAR(255) NOT NULL, ASCII non vide, `octet_length(subject) <= 255`, comparaison exacte |
| `status` | enum `ACTIVE` / `REVOKED`, NOT NULL |
| `verified_at`, `created_at`, `updated_at` | TIMESTAMPTZ NOT NULL |
| `revoked_at` | TIMESTAMPTZ NULL; cohérence imposée avec `status` par CHECK |
| `created_by_user_id` | UUID NOT NULL → `users.id`, `ON DELETE RESTRICT` |
| `revoked_by_user_id` | UUID NULL → `users.id`, `ON DELETE RESTRICT` |

Une contrainte UNIQUE non partielle sur `(issuer, subject)` couvre aussi les lignes révoquées. Une seconde clé unique `(id,user_id)` permet aux challenges de référencer une identité tout en imposant le même propriétaire au niveau SQL. Des CHECK imposent l'issuer HTTPS ASCII sans query/fragment, les limites en octets indiquées ci-dessus et `(status=ACTIVE, revoked_at=NULL, revoked_by_user_id=NULL)` ou `(status=REVOKED, revoked_at NOT NULL, revoked_by_user_id NOT NULL)`. L'ASCII rend la limite d'index exprimée en octets déterministe; aucune valeur n'est tronquée ou normalisée. Un trigger PostgreSQL interdit de supprimer une identité et de modifier `id`, `user_id`, `issuer`, `subject`, `created_by_user_id` ou `created_at`; `verified_at` et les attributs de révocation ne changent qu'avec une transition ACTIVE↔REVOKED. Il n'y a ni cascade de suppression, ni transfert de propriétaire, ni backfill des lignes utilisateur.

La limite de `subject` à 255 ASCII suit [OpenID Connect Core 1.0, section 2](https://openid.net/specs/openid-connect-core-1_0.html#IDToken); cette spécification définit aussi l'issuer comme un URL HTTPS sans query/fragment et impose une correspondance exacte. Le contrat exige une représentation URI ASCII valide de l'issuer, bornée à 2048 caractères et octets, pour que la taille maximale de l'index composé PostgreSQL soit déterministe. L'issuer et le subject ne sont jamais tronqués ou normalisés. Leur index unique est testé avec les tailles maximales admises.

`ExternalIdentityLinkChallenge` est stockée dans `external_identity_link_challenges` : `id UUID PK`, `user_id UUID NOT NULL`, `session_id UUID NOT NULL`, `state_hash CHAR(64) UNIQUE NOT NULL`, `nonce_hash CHAR(64) UNIQUE NOT NULL`, `expires_at TIMESTAMPTZ NOT NULL`, `consumed_at TIMESTAMPTZ NULL`, `external_identity_id UUID NULL`, `created_at TIMESTAMPTZ NOT NULL`. Une clé unique `(id,user_id)` sur `refresh_sessions` permet à une FK composite de lier `(session_id,user_id)` à la session réellement détenue par cet utilisateur (`ON DELETE CASCADE`), et une autre lie `(external_identity_id,user_id)` à l'identité consommée (`ON DELETE RESTRICT`); une liaison ne peut donc pas associer en base un challenge, une session ou une identité à des propriétaires différents. Ces deux index composites sont intentionnellement redondants avec les clés primaires sur `id` : ils matérialisent la contrainte de propriété côté PostgreSQL. Le challenge éphémère ne survit pas à la session. Un CHECK exige `expires_at > created_at` et `consumed_at`/`external_identity_id` tous deux nuls ou tous deux non nuls. Le rejeu strictement identique reste idempotent durant les 24 heures qui suivent `expires_at`; les challenges sont supprimables ensuite. Les valeurs brutes state/nonce ne sont jamais conservées.

Le verrouillage de challenge et le `consumed_at` compare-and-set, l'insertion/réactivation de l'identité, l'audit et l'Outbox sont dans la même transaction. Un trigger PostgreSQL rend immuables la liaison utilisateur/session, les hashes, l'expiration et la création; une consommation ne peut passer qu'une fois de l'état non consommé à consommé et ne peut ensuite être modifiée. Le rejeu strictement identique du même challenge retourne l'identité déjà liée sans nouvelle mutation, audit ou Outbox. Un challenge utilisé avec un autre issuer/subject, un autre propriétaire ou un contenu divergent est refusé. Une révocation répétée déjà appliquée est idempotente et ne produit pas de second événement.

### 7.2 Contrat des commandes internes C2.2

- `beginExternalIdentityLink(principal, currentPassword)` vérifie l'utilisateur et la session legacy actifs, effectue la réauthentification, crée l'intention à usage unique et retourne les valeurs brutes state/nonce une seule fois avec l'identifiant et l'expiration du challenge.
- `completeExternalIdentityLink(verifiedProof)` n'accepte que la preuve typée créée par l'adaptateur de vérification interne; elle doit contenir le challenge, state, nonce, issuer et subject validés. Aucun contrôleur public ou endpoint OIDC n'est livré en C2.2.
- `revokeExternalIdentity(principal, identityId, currentPassword)` ne révoque que l'identité appartenant à l'utilisateur courant; toute révocation plateforme ultérieure doit passer par `PlatformAuthorizationService`, une capacité explicite et un événement audité.
- `resolveActiveExternalIdentity(issuer, subject)` ne retourne qu'un `User.id` interne pour une identité ACTIVE; l'appel n'accorde aucun rôle, membership, entitlement ou permission.

Les événements Outbox omettent userId, subject, state, nonce, jetons et email. L'identifiant interne d'agrégat et l'acteur authentifié suffisent à la corrélation; l'issuer n'est inclus que dans le payload minimisé et classifié `CONFIDENTIAL`.

### 7.3 Provenance des principals et résolution produit C2.3

- `AuthPrincipal` reste inchangé pour tous les contrôleurs et services existants. `AuthGuard` continue de valider le JWT legacy puis la session active en base avant de construire le principal. Il pose séparément `VerifiedUserPrincipal { identityType: INTERNAL_USER, provenance: LEGACY_SESSION, userId, sessionId }`. Ce prouveur décrit l'authentification uniquement et n'attribue aucun acteur métier. `CurrentPrincipal` conserve exactement son type et son comportement; `CurrentAuthenticatedIdentity` expose uniquement cette provenance vérifiée.
- `STAFF` est attribué seulement après résolution côté serveur d'un membership actif par `AuthorizationService`. Les nouveaux contextes product-scoped retournent `StaffAuthorizationContext` avec la provenance `ACTIVE_TENANT_MEMBERSHIP`; le client ne peut pas créer ce contexte avec `actorType` ou un rôle fourni en entrée.
- `PLATFORM` est attribué séparément par `PlatformAuthorizationService` après vérification de la liste serveur `PLATFORM_ADMIN_USER_IDS`; son contexte porte `SERVER_CONFIGURED_PLATFORM_ADMIN`. Cette capacité ne devient pas un bypass générique de membership, tenancy, produit, suspension ou propriété des ressources. Les opérations plateforme restent responsables d'appliquer leurs contrôles d'action et d'audit existants.
- Aucun principal BUYER ou AGENT n'est émis par l'authentification HTTP C2.3. Leur énumération normative ne vaut pas authenticator/runtime; ces catégories restent fail-closed et non disponibles tant que leurs preuves propres ne sont pas livrées.
- Le port interne `IdentityProviderPort` décrit la vérification d'un ID token OIDC et retourne seulement issuer, subject, audience, instants d'émission/expiration/vérification, algorithme retenu et preuve de nonce validée. L'adaptateur est absent du graphe Nest, n'est pas injecté et ne participe ni au démarrage ni aux routes legacy. Une future implémentation doit valider signature via clés publiées/rotation, algorithmes explicitement admis, issuer exact autorisé, audience, `exp`, `nbf`, `iat` et nonce; elle doit ensuite résoudre le couple exact issuer/subject par `ExternalIdentityService`. Claims métier et email sont hors du résultat minimal et n'accordent jamais de rôle.
- `requireModuleForProduct(principal, organizationId, productCode, moduleCode, permission)` est le chemin explicite d'autorisation produit. Il valide le code contrôlé, résout un membership STAFF actif depuis PostgreSQL, vérifie la matrice de permissions puis utilise exclusivement `resolveForProduct`. Il refuse toute incohérence de tenant/produit ou module absent/interdit et ne retombe jamais sur l'entitlement Connect. `requireModule` reste l'API historique Connect.
- `requireModuleForProductInTransaction(tx, ...)` refait membership, état d'organisation/utilisateur, rôle, portée et entitlement produit dans la transaction fournie, en verrouillant le membership comme les mutations métier existantes. Les consommateurs d'opérations transactionnelles utilisent cette variante; le contexte ne remplace pas les vérifications de propriété de ressource ni `assertEstablishment`.
- L'organisation et l'établissement restent des sélecteurs de cible, non une preuve. L'établissement doit encore appartenir à l'organisation et satisfaire le scope serveur du membership. La suspension globale demeure prioritaire via l'entitlement effectif; une suspension ou absence d'abonnement produit ne modifie pas les droits d'un autre produit.
- Le port OIDC et les catégories futures ne modifient pas la représentation JWT, la durée des sessions, les réponses API ou les données historiques. OIDC réel, BUYER, AGENT, commandes POS et liaison d'acteur à une ressource restent `NOT_CONFIGURED`/`PLANNED` jusqu'à leurs lots autorisés.

## 8. Contrats externes

C2 ne publie aucun endpoint OIDC de login ou de liaison tant que le protocole complet et le fournisseur configuré ne sont pas livrés et vérifiés. L'interface de service est interne et versionnée dans le code. Aucun schéma Prisma, rôle SQL ou connexion DB n'est exporté vers ZAMUREK. Le dépôt public ZAMUREK reste limité à des contrats OpenAPI explicitement filtrés et validés.

## 9. Tests et critères d'acceptation

Les PR C2 doivent prouver par tests unitaires, PostgreSQL et HTTP applicables :

- Unicité issuer/subject, casse exacte, réactivation du même propriétaire, refus de réattribution après révocation et concurrence de liaison.
- Issuer/subject absents, issuer non configuré, preuve expirée/non liée, tentative de liaison par email identique et absence de stockage du jeton.
- Conservation des `User.id`, JWT et refresh sessions legacy; accès HTTP historique inchangé.
- Staff autorisé/refusé selon membership, rôle, scope établissement, produit, suspension globale/produit et ressource.
- Buyer interdit des routes staff et des ressources d'un tiers; identifiant d'objet seul non autorisant.
- Agent sans délégation valide refusé; capacité PLATFORM limitée et auditée; champs tenant/produit/acteur forgés ignorés.
- Audit et Outbox atomiques et aucun doublon sous rejeu.
- Migration additive depuis base vide et états historiques supportés, sans backfill destructif ni remplacement d'identifiants.

Une interface sans provider, une preuve synthétique ou un test unitaire ne constitue pas une intégration OIDC runtime. Monarque Auth, BUYER complet et runtime AGENT restent `PLANNED/NOT_RUN` si non livrés.
