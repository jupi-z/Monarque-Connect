# 52 — Phase 1 Identity & Tenancy Execution Specification

## Objet

Cette spécification ferme les ambiguïtés nécessaires pour exécuter la Phase 1 après validation de la Phase 0.5.

## 1. User

Champs minimum :
- id UUID
- email normalisé, unique
- phone optionnel
- password_hash
- first_name
- last_name
- status `ACTIVE | SUSPENDED`
- email_verified_at optionnel
- created_at / updated_at

Normalisation email : trim + lowercase.

## 2. Password

- minimum 15 caractères ;
- maximum 128 caractères ;
- Unicode et espaces acceptés ;
- pas de règle arbitraire majuscule/symbole ;
- Argon2id ;
- paramètres centralisés et benchmarkés avant production ;
- aucun mot de passe dans logs, events ou audit payloads.

## 3. Sessions

### Access token
- JWT asymétrique ;
- TTL par défaut 900 secondes ;
- claims : `sub`, `sid`, `jti`, `iss`, `aud`, `iat`, `exp` ;
- aucun rôle tenant figé comme autorité durable dans le token.

### Refresh token
- opaque, 256 bits cryptographiquement aléatoires minimum ;
- TTL par défaut 30 jours ;
- hash SHA-256 en DB ;
- rotation à chaque refresh ;
- famille de tokens ;
- replay d'un token remplacé/révoqué => révocation de la famille + audit.

Les clients ne stockent jamais un refresh token Web dans localStorage. Les clients natifs utilisent le stockage sécurisé de la plateforme ; les clients Web utilisent une stratégie HttpOnly/BFF approuvée.

## 4. Register

`POST /auth/register`

Entrée :
- email
- password
- firstName
- lastName
- phone optionnel

Effets :
1. validation/normalisation ;
2. refus générique en cas de conflit exploitable ;
3. création User ACTIVE ;
4. émission `user.registered.v1`.

L'inscription ne crée pas automatiquement une organization.

## 5. Login / Refresh / Logout

Login :
- réponse générique en cas d'échec ;
- rate limit ;
- session créée avec familyId ;
- access + refresh tokens.

Refresh :
- rotation atomique ;
- ancienne session marquée remplacée ;
- replay => famille révoquée.

Logout :
- session courante révoquée.

Change password :
- mot de passe courant requis ;
- hash remplacé ;
- toutes les autres sessions révoquées ;
- événement/audit approprié.

## 6. Create Organization

`POST /organizations`

Transaction unique :
1. business type actif validé ;
2. handle normalisé et unique ;
3. Organization créée ;
4. Establishment principal créé ;
5. Membership OWNER créée pour l'utilisateur ;
6. scope `ALL_ESTABLISHMENTS` ;
7. événements outbox créés.

Valeurs établissement principal :
- `code = HQ`
- `type = HEAD_OFFICE`
- `name = organization.name`
- `is_primary = true`
- status ACTIVE

Events :
- `organization.created.v1`
- `establishment.created.v1`
- `membership.created.v1`

Tous partagent le même correlationId.

## 7. Memberships

Rôles :
- OWNER
- ADMIN
- SALES
- FINANCE
- OPERATIONS
- VIEWER

Status :
- ACTIVE
- SUSPENDED

Scope mode :
- ALL_ESTABLISHMENTS
- SELECTED_ESTABLISHMENTS

Règles :
- au moins un OWNER ACTIVE ;
- seul OWNER peut promouvoir un membre en OWNER ou rétrograder un autre OWNER ;
- un OWNER ne peut se rétrograder/suspendre s'il est le dernier OWNER actif ;
- ADMIN peut gérer les rôles non-OWNER et les scopes ;
- aucun membre ne peut élargir son propre scope au-delà de ce que sa policy autorise.

## 8. Invitations

Création par OWNER/ADMIN selon policy.

Champs :
- organization
- normalized email
- rôle cible hors OWNER
- scope mode
- establishment IDs si SELECTED
- token hash
- expires_at
- accepted_at / revoked_at

Token :
- 256 bits minimum ;
- stocké hashé ;
- TTL initial 7 jours ;
- usage unique.

Acceptation via `POST /invitations/accept` avec le token dans le body, jamais dans l'URL.

1. user authentifié ;
2. email normalisé du user = email invitation ;
3. token valide/non expiré/non révoqué ;
4. organization active ;
5. transaction membership + scopes + invitation accepted ;
6. `membership.created.v1`.

Le transport email est un adapter. En production, le token n'est jamais exposé dans des logs.

## 9. Establishments

Status :
- ACTIVE
- INACTIVE

Règles :
- un seul principal par organization ;
- le principal ne peut être désactivé sans désigner un nouveau principal dans la même transaction ;
- code unique par organization ;
- toute modification sensible auditée ;
- création soumise au quota effectif dès Phase 2.

## 10. API de gestion membership requise

Phase 1 doit couvrir :
- lister membres ;
- modifier rôle/status/scope d'un membre ;
- créer/lister/révoquer invitations ;
- accepter invitation ;
- lister/créer/modifier établissements.

Le contrat OpenAPI est détaillé avant merge de l'implémentation.

## 11. Events Phase 1

Minimum :
- user.registered
- user.suspended
- organization.created
- organization.suspended
- establishment.created
- establishment.updated
- membership.created
- membership.role_changed
- membership.scope_changed
- membership.suspended
- invitation.created
- invitation.accepted
- invitation.revoked

Aucun event ne contient refresh token, password hash ou token d'invitation.

## 12. Tests gate

- deux tenants sans fuite ;
- IDs valides d'un autre tenant sans fuite ;
- ALL vs SELECTED establishments ;
- dernier OWNER protégé ;
- promotion OWNER réservée à OWNER ;
- invitation expirée/révoquée/rejouée ;
- refresh replay ;
- suspension user ;
- transaction create organization rollback-safe ;
- events outbox atomiques ;
- CI verte.
