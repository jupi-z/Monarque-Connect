# 50 — Event Fabric Implementation Specification

## 1. Objectif

Cette spécification rend la Phase 0.5 directement implémentable.

Le MVP Event Fabric doit fournir une livraison durable, versionnée, observable et idempotente des Domain Events **sans broker distribué** et sans introduire d'event sourcing.

Architecture MVP :

`Core transaction → PostgreSQL transaction → outbox_events → worker → consumers idempotents`

Le Core transactionnel reste la source de vérité.

## 2. Non-objectifs

La Phase 0.5 n'implémente pas :
- Kafka, RabbitMQ, NATS ou autre broker ;
- event sourcing du Core ;
- reconstruction des agrégats à partir des événements ;
- Knowledge Layer persistée ;
- embeddings/vector database ;
- fournisseur IA ;
- chatbot ;
- agent runtime réel ;
- notifications métier finales.

## 3. Modèles persistants obligatoires

### 3.1 outbox_events

Champs :

- `id UUID PK` ;
- `event_type varchar(160)` ;
- `event_version int` ;
- `organization_id UUID nullable` ;
- `establishment_id UUID nullable` ;
- `actor_type enum(USER,SYSTEM,AGENT,PLATFORM)` ;
- `actor_id UUID nullable` ;
- `aggregate_type varchar(120)` ;
- `aggregate_id UUID` ;
- `correlation_id UUID` ;
- `causation_id UUID nullable` ;
- `request_id varchar(200) nullable` ;
- `data_classification enum(PUBLIC,INTERNAL,CONFIDENTIAL,RESTRICTED)` ;
- `purpose varchar(200)` ;
- `payload_json jsonb` ;
- `status enum(PENDING,PROCESSING,PROCESSED,FAILED)` ;
- `attempts int default 0` ;
- `next_attempt_at timestamptz nullable` ;
- `locked_at timestamptz nullable` ;
- `locked_by varchar(160) nullable` ;
- `processed_at timestamptz nullable` ;
- `last_error_code varchar(120) nullable` ;
- `last_error_message varchar(1000) nullable` ;
- `occurred_at timestamptz` ;
- `recorded_at timestamptz default now()`.

Contraintes :
- `event_version >= 1` ;
- `attempts >= 0` ;
- `payload_json` doit être un objet JSON ;
- aucun secret/password/token dans le payload ;
- une ligne `PROCESSED` n'est jamais réécrite métier ;
- une correction métier produit un nouvel événement.

Index minimaux :
- `(status, next_attempt_at, recorded_at)` ;
- `(organization_id, recorded_at)` ;
- `(aggregate_type, aggregate_id, recorded_at)` ;
- `correlation_id`.

### 3.2 event_consumer_receipts

Champs :
- `id UUID PK` ;
- `consumer_name varchar(160)` ;
- `event_id UUID FK outbox_events(id)` ;
- `processed_at timestamptz`.

Contrainte unique :
- `UNIQUE(consumer_name, event_id)`.

Cette contrainte est la barrière principale contre le double traitement interne.

## 4. Écriture atomique

Toute commande métier produisant un événement critique doit écrire :
1. l'état métier ;
2. la ligne `outbox_events` ;
3. dans **la même transaction PostgreSQL**.

Interdit :
- commit métier puis création de l'événement dans une seconde transaction ;
- émission uniquement en mémoire ;
- appel réseau vers un consumer dans la transaction métier.

Le service d'application doit utiliser une abstraction du type :

`OutboxWriter.enqueue(tx, domainEvent)`

où `tx` est le client transactionnel Prisma reçu par le use-case.

## 5. Context propagation

Chaque requête HTTP reçoit côté serveur :
- un `requestId` ;
- un `correlationId`.

Ces identifiants sont propagés dans le contexte applicatif et dans les événements.

Règles :
- ils sont générés côté serveur pour les appels publics ;
- un worker causé par un événement réutilise le `correlationId` d'origine ;
- `causationId` pointe vers l'`eventId` déclencheur lorsqu'il existe ;
- un nouvel événement asynchrone a son propre `eventId`.

Le contexte ne contient jamais de permission persistante : RBAC/tenant/entitlement sont toujours revalidés au moment de l'action.

## 6. Actor

Les valeurs canoniques sont :
- `USER` : action d'un utilisateur tenant ;
- `SYSTEM` : job/worker interne ;
- `AGENT` : futur agent IA délégué ;
- `PLATFORM` : action du Control Plane.

`actor_id` est nullable uniquement lorsque le type et le contexte rendent l'absence d'identifiant légitime, par exemple un job système.

## 7. Worker

### 7.1 Claim

Le worker peut avoir plusieurs instances.

Chaque cycle :
1. ouvre une transaction courte ;
2. sélectionne un batch éligible avec verrouillage PostgreSQL `FOR UPDATE SKIP LOCKED` ;
3. les lignes éligibles sont :
   - `PENDING` avec `next_attempt_at <= now()` ou null ;
   - `PROCESSING` dont le lease a expiré ;
4. passe les lignes en `PROCESSING` ;
5. incrémente `attempts` ;
6. renseigne `locked_at` et `locked_by` ;
7. commit ;
8. traite les événements hors verrou DB long.

Prisma peut utiliser du SQL paramétré via `$queryRaw` lorsque `SKIP LOCKED` n'est pas exposé proprement par l'ORM.

### 7.2 Paramètres initiaux

Valeurs de départ configurables :
- batch size : 50 ;
- poll interval : 1000 ms ;
- lease : 60 s ;
- max attempts : 8.

Ce sont des valeurs opératoires, pas des invariants produit.

### 7.3 Retry

Backoff initial recommandé :
`1s → 5s → 30s → 2m → 5m`, puis plafond 5 minutes.

Après `maxAttempts` :
- statut `FAILED` ;
- erreur sanitizée enregistrée ;
- métrique/alerte opérationnelle ;
- aucun rollback de la transaction métier d'origine.

Une réactivation manuelle future doit remettre explicitement l'événement en `PENDING` et être auditée.

## 8. Dispatch et consumers

Le dispatcher résout les consumers par `eventType + eventVersion`.

Un consumer doit :
- avoir un `consumerName` stable ;
- accepter un événement validé ;
- être idempotent ;
- ne jamais supposer une livraison exactly-once ;
- ne jamais faire confiance au payload pour l'autorisation.

### Consumer DB interne

Pour une projection DB :
1. ouvrir une transaction ;
2. vérifier/insérer le receipt `(consumerName,eventId)` ;
3. si receipt existe : no-op ;
4. appliquer l'effet ;
5. commit receipt + effet ensemble.

### Effet externe futur

Pour email, webhook ou service externe :
- transmettre `eventId` comme clé d'idempotence lorsque le fournisseur le permet ;
- sinon passer par une outbox dédiée à l'intégration ;
- ne jamais considérer un simple retry HTTP comme exactly-once.

## 9. Fin de traitement

Un événement passe à `PROCESSED` uniquement lorsque tous les consumers enregistrés pour cette version ont réussi ou ont déjà un receipt.

À succès :
- `processed_at = now()` ;
- `locked_at = null` ;
- `locked_by = null` ;
- `last_error_*` nettoyés.

À échec récupérable :
- statut `PENDING` ;
- `next_attempt_at` calculé ;
- lease libéré.

À échec terminal :
- statut `FAILED`.

## 10. Ordering

Aucun ordre global n'est garanti.

Le MVP ne garantit pas un ordre strict cross-worker par aggregate. Les consumers doivent :
- utiliser l'état courant du Core lorsque nécessaire ;
- accepter événements retardés/répétés ;
- ne pas déduire une vérité financière uniquement de l'ordre d'arrivée.

Si une verticale exige un ordre strict par aggregate, elle doit introduire explicitement un mécanisme de version/séquence et un ADR.

## 11. Rétention

Au MVP, les événements `PROCESSED` sont conservés afin de préserver l'historique nécessaire aux projections et à Intelligence.

Aucune purge automatique destructive n'est activée en Phase 0.5.

Avant que le volume impose archivage/partitionnement :
- définir une politique de rétention ;
- garantir que les projections nécessaires restent reconstruisibles ;
- ajouter ADR + migration + tests de restauration.

## 12. Observabilité

Métriques minimales :
- `outbox_pending_total` ;
- `outbox_failed_total` ;
- `outbox_processing_total` ;
- âge du plus ancien PENDING ;
- attempts moyen/max ;
- durée de traitement ;
- succès/échec par `eventType` et `consumerName`.

Logs structurés :
- `eventId` ;
- `eventType` ;
- `eventVersion` ;
- `correlationId` ;
- `organizationId` lorsque permis ;
- `consumerName` ;
- `attempt` ;
- résultat.

Ne pas logger le payload brut par défaut.

## 13. Structure de code recommandée

```text
src/
  common/
    context/
      request-context.*
  events/
    domain-event.*
    domain-event.factory.*
    outbox.writer.*
    outbox.repository.*
    event.dispatcher.*
    event-consumer.*
    event-worker.*
    event.module.*
```

La structure peut être ajustée sans modifier les frontières :
- Core produit le fait ;
- Outbox le rend durable ;
- Worker le transporte ;
- Consumer traite de façon idempotente.

## 14. Use-case de preuve Phase 0.5

Créer un use-case technique minimal, non commercial, qui :
1. écrit une petite ressource de démonstration ou un fait de fondation ;
2. ajoute un DomainEvent dans la même transaction ;
3. un consumer crée une projection/receipt ;
4. un replay du même événement ne duplique pas l'effet.

La preuve ne doit pas introduire une fausse verticale métier.

## 15. Tests obligatoires

### Transaction
- succès métier => état + event présents ;
- rollback métier => ni état ni event ;
- échec d'insertion event => transaction métier annulée.

### Worker
- deux workers ne claim pas la même ligne simultanément ;
- lease expiré est récupérable ;
- retry augmente `attempts` ;
- max attempts => FAILED.

### Consumer
- replay => un seul effet ;
- crash avant commit => retry possible ;
- receipt + effet atomiques ;
- event version inconnue => refus contrôlé.

### Sécurité
- payload sans secrets ;
- classification obligatoire ;
- actor/tenant/context attendus ;
- erreur enregistrée sanitizée.

### CI
- migration depuis base vide ;
- tests PostgreSQL réels ;
- lint/typecheck/tests/build verts.

## 16. Gate de sortie Phase 0.5

Phase 0.5 est terminée uniquement lorsque :
- schema Prisma + migration outbox/receipts existent ;
- transaction + outbox atomique sont prouvées ;
- worker multi-instance safe est prouvé ;
- replay idempotent est prouvé ;
- retry/FAILED sont testés ;
- request/correlation/causation sont propagés ;
- CI PostgreSQL est verte ;
- aucun fournisseur IA/broker n'a été ajouté.

Après ce gate seulement, Phase 1 peut démarrer.
