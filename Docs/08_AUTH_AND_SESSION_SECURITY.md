# 08 — Authentification et sécurité des sessions

## Auth V1

Authentification par mot de passe, access token court et refresh token opaque rotatif.

### Access token
- JWT signé asymétriquement ;
- TTL par défaut : 900 secondes ;
- claims minimaux : `sub`, `sid`, `jti`, `iat`, `exp`, `iss`, `aud` ;
- `kid` dans l'en-tête JWT ;
- les rôles tenant ne sont jamais considérés comme une autorité durable dans le token.

### Refresh token
- 256 bits aléatoires cryptographiquement sûrs minimum ;
- opaque ;
- TTL par défaut : 30 jours ;
- hash SHA-256 stocké en base ;
- rotation à chaque refresh ;
- famille de tokens pour détecter la réutilisation.

## Réutilisation d'un refresh token

Si un token déjà remplacé/révoqué est présenté :
1. refuser ;
2. révoquer la famille concernée ;
3. créer un AuditEvent ;
4. obliger une nouvelle authentification.

## Mot de passe

Baseline :
- minimum 15 caractères ;
- maximum 128 ;
- Unicode et espaces acceptés ;
- pas de règle arbitraire « majuscule + symbole » ;
- Argon2id ;
- paramètres centralisés et benchmarkés avant production ;
- aucun changement périodique forcé sans indication de compromission.

## Login

- erreur générique en cas d'échec ;
- rate limiting edge + applicatif lorsque l'infrastructure le permet ;
- aucun verrouillage permanent exploitable pour DoS ;
- les événements et logs ne contiennent jamais le mot de passe.

## Clés JWT

- clé privée hors Git ;
- fichiers montés/secret manager ;
- `JWT_PRIVATE_KEY_PATH` et `JWT_PUBLIC_KEY_PATH` requis en staging/production ;
- `JWT_KEY_ID` pour rotation ;
- possibilité de conserver l'ancienne clé publique pendant la durée de validité des access tokens.

## Transport et stockage client

Tokens uniquement sur TLS.

- client natif : refresh token en stockage sécurisé ;
- client Web : HttpOnly/BFF ou stratégie équivalente approuvée ;
- localStorage interdit pour refresh token.

Le backend reste API-first et ne dépend pas d'une UI particulière.

## Invitations

- token opaque 256 bits minimum ;
- hashé en DB ;
- TTL initial 7 jours ;
- usage unique ;
- révocable ;
- l'utilisateur authentifié doit porter le même email normalisé que l'invitation ;
- le token d'invitation n'est jamais loggé.

## Password reset

Le reset automatique n'est pas activé tant qu'un canal vérifié n'est pas implémenté. Aucun reset « support » faible basé sur des informations personnelles.

## Changement de mot de passe

- mot de passe courant requis ;
- nouvelle politique validée ;
- toutes les autres sessions révoquées ;
- événement/audit créé.

## Suspension

La suspension d'un User :
- révoque les refresh sessions ;
- empêche l'utilisation fonctionnelle d'un access token au prochain appel serveur ;
- est auditée.

La spécification d'exécution complète de Phase 1 est `52_PHASE1_IDENTITY_TENANCY_EXECUTION_SPEC.md`.
