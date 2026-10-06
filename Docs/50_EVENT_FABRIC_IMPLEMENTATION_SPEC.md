# 50 — Event Fabric Implementation Specification

## Objet

Cette spécification transforme l'architecture AI-native en règles d'implémentation précises pour la Phase 0.5.

Le MVP utilise PostgreSQL comme mécanisme durable. Aucun broker distribué n'est requis.

## 1. OutboxEvent

Statuts :
- `PENDING`
- `PROCESSING`
- `PUBLISHED`
- `FAILED`

Champs obligatoires en plus de l'envelope canonique :
- `status`
- `attempts`
- `next_attempt_at`
- `locked_at?`
- `locked_by?`
- `last_error_code?`
- `last_error_at?`
- `published_at?`

Le payload cible reste inférieur à 64 KiB. Un document ou binaire volumineux est référencé par ID, jamais embarqué.

## 2. Atomicité

Toute mutation critique suit :

`business writes + OutboxEvent INSERT → COMMIT unique`

Si la transaction rollback, l'événement n'existe pas.

Aucun code ne publie un événement critique après commit sans outbox.

## 3. Claim worker

Le worker :
1. sélectionne un batch de `PENDING` dont `next_attempt_at <= now()` ;
2. utilise une transaction et `FOR UPDATE SKIP LOCKED` ou mécanisme PostgreSQL équivalent ;
3. marque les lignes `PROCESSING` avec `locked_at`, `locked_by` et incrémente `attempts` ;
4. commit le claim ;
5. traite hors transaction de claim.

Batch initial : 50 événements maximum.

## 4. Lease recovery

Un événement `PROCESSING` dont le lease dépasse 60 secondes est récupérable.

Le worker de récupération le remet à `PENDING` sauf si le nombre maximum de tentatives est atteint.

Aucun lock mémoire local ne constitue la source de vérité.

## 5. Retry

Backoff initial :
- tentative 1 : immédiate ;
- 2 : +1 s ;
- 3 : +5 s ;
- 4 : +30 s ;
- 5 : +2 min ;
- 6 : +10 min.

Après 6 échecs : `FAILED`.

Un événement FAILED reste conservé et observable. La remise en file future est une opération plateforme auditée.

## 6. Delivery / consumers

Le MVP utilise un dispatcher interne avec consumers enregistrés par `consumerCode`.

Chaque consumer durable doit être idempotent.

Table conceptuelle `event_consumptions` :
- `event_id`
- `consumer_code`
- `processed_at`
- PK unique `(event_id, consumer_code)`

L'effet métier du consumer et l'insertion de son receipt doivent appartenir à la même transaction quand un effet durable est produit.

Si un consumer a déjà son receipt, le retry retourne succès sans répéter l'effet.

## 7. Publication

Un OutboxEvent devient `PUBLISHED` lorsque tous les consumers durables enregistrés pour son type ont réussi ou ont déjà un receipt.

Si un consumer échoue, l'événement suit la politique de retry.

Cette convention pourra évoluer vers broker + inbox par ADR sans changer l'envelope métier.

## 8. Correlation et causation

### Requête HTTP racine
- `requestId` : généré par le serveur ;
- `correlationId` : généré par le serveur au début du use-case, ou propagé depuis un contexte interne de confiance ;
- `causationId` : null pour le premier fait.

### Consumer
Un événement créé en réaction à un événement E :
- réutilise `correlationId` de E ;
- utilise `causationId = E.eventId`.

Une valeur client arbitraire ne devient jamais automatiquement un identifiant interne de confiance.

## 9. Classification

Chaque producer choisit explicitement :
- PUBLIC
- INTERNAL
- CONFIDENTIAL
- RESTRICTED

`PLATFORM_SECRET` n'est pas accepté dans un DomainEvent.

En cas de doute, choisir la classe la plus restrictive.

## 10. Phase 0.5 — preuve obligatoire

Le use-case de preuve doit démontrer :
1. transaction métier + outbox ;
2. rollback sans événement orphelin ;
3. worker multi-instance safe ;
4. consumer receipt ;
5. retry sans duplication ;
6. FAILED après politique de retry ;
7. propagation correlation/causation ;
8. aucune donnée secrète dans le payload.

Cette preuve est requise avant Phase 1.
