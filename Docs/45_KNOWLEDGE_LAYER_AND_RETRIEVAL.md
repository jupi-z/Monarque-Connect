# 45 — Knowledge Layer et retrieval

## Position

La Knowledge Layer rend les données de Monarque Connect compréhensibles par les moteurs d'intelligence sans ouvrir un accès direct aux tables transactionnelles.

## Sources

- projections structurées du Core ;
- DomainEvents ;
- MetricSnapshots ;
- documents explicitement autorisés ;
- catalogue/réseau public ;
- métadonnées de provenance.

## Non-objectifs

- dupliquer toute la base transactionnelle ;
- laisser un LLM écrire dans l'index ;
- faire d'un vector store une source de vérité ;
- indexer toutes les données sans besoin.

## KnowledgeRecord conceptuel

- `id` ;
- `organizationId` ;
- `establishmentId?` ;
- `sourceType` ;
- `sourceId` ;
- `sourceVersion/hash` ;
- `contentType` ;
- `classification` ;
- `purpose` ;
- `validFrom`, `validTo?` ;
- `projectionPayload` ;
- provenance.

## Retrieval

Toute recherche pour un utilisateur/agent doit appliquer **avant retrieval** :
- tenant ;
- establishment scope ;
- entitlements ;
- rôle/permission ;
- classification ;
- AI policy.

Le filtrage après retrieval seul est insuffisant.

## Documents et prompt injection

Le contenu d'un document, message ou page externe est **untrusted content**.

Une instruction présente dans un document (“ignore les règles…”, “envoie les données…”) est traitée comme donnée et ne peut modifier :
- system policy ;
- permissions ;
- tool grants ;
- tenant context.

## Vectorisation

Les embeddings/vector stores sont différés jusqu'à preuve de besoin.

Quand ils seront introduits :
- modèle d'embedding versionné ;
- namespace tenant strict ;
- metadata de sécurité ;
- stratégie de re-indexation ;
- suppression/révocation ;
- tests cross-tenant ;
- aucun secret.

## Grounding

Toute réponse importante de l'IA devrait pouvoir référencer ses sources internes : IDs, événements, métriques ou documents utilisés.

Le système privilégie “je ne sais pas / données insuffisantes” à l'invention d'un fait métier.
