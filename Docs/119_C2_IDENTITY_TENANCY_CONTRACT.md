# C2 — Identity, Tenancy & Tenant Principals

**Statut :** contrat normatif C2.1 — prêt pour exécution incrémentale. C2.2–C2.4 restent à livrer et ne sont pas réputés implémentés par ce document.
**Baseline vérifiée :** `main@e34e9fa0d7c92cd0ae69a82d1b39110906fbaec3`; CI post-fusion #540 verte.
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

- `issuer` est l'identifiant exact de l'émetteur OIDC configuré et validé par le serveur; comparaison exacte, sensible à la casse, sans normalisation d'URL. Les émetteurs de production devront utiliser HTTPS.
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

Toute liaison, réactivation ou révocation persistée doit écrire l'état, l'audit et l'Outbox dans la même transaction PostgreSQL. Les actions d'audit sont `EXTERNAL_IDENTITY_LINKED`, `EXTERNAL_IDENTITY_REACTIVATED` et `EXTERNAL_IDENTITY_REVOKED`; les événements version 1 sont `identity.external_identity.linked`, `identity.external_identity.reactivated` et `identity.external_identity.revoked`. Ils sont minimisés : ID de l'association, issuer et action; jamais de jeton, secret, email ni claim complet. Le subject et le userId ne sont pas copiés dans le payload Outbox générique; l'acteur utilisateur déjà porté par l'enveloppe fournit l'attribution. Le subject reste dans le registre protégé.

Les requêtes concurrentes sur la même paire `(issuer, subject)` sont arbitrées par l'unicité SQL. Le challenge est consommé par compare-and-set dans la transaction de liaison; un rejeu ne peut jamais créer de seconde transition. Une liaison vers un autre utilisateur, une preuve expirée/non liée, ou une révocation déjà incompatible échoue sans mutation partielle. Les preuves et commandes doivent avoir une portée unique, expirable et liée à une session.

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
