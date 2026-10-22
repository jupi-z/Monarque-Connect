# 42 — AI-Native Foundation

> **Complément 22/10/2026 :** les principes ci-dessous appartiennent au socle **unique partagé** avec ZAMUREK ([ADR-039](104_ADR_039_SHARED_COMMERCE_CORE_ZAMUREK.md)). Event Fabric + 10A sont livrées ; Gateway/model registry et agents complets restent planifiés en 10B/11.5. Aucun runtime supplémentaire dans ZAMUREK.

## Décision

Monarque Connect est **AI-native dès ses fondations, mais jamais AI-dependent pour sa vérité transactionnelle**.

L'IA doit pouvoir comprendre, expliquer, prévoir, recommander et, plus tard, agir. Elle ne devient jamais l'autorité qui décide de l'existence d'un paiement, d'un solde, d'un droit, d'un stock ou d'un état métier.

## Architecture cible

```text
Monarque Core
  ↓ domain events
Monarque Event Fabric
  ↓ governed projections
Monarque Knowledge Layer
  ↓ policy-controlled retrieval
Monarque Intelligence Engine
  ↓ proposed actions / explanations
Monarque Agent Runtime
  ↓ authorized commands
Monarque Core
```

## 1. Monarque Core

Source de vérité déterministe :
- identité ;
- tenants/établissements ;
- entitlements ;
- CRM ;
- ventes/achats ;
- facturation/paiements ;
- stock/caisse ;
- projets ;
- réseau ;
- documents.

Aucun LLM ne modifie directement PostgreSQL.

## 2. Event Fabric

Chaque transition métier significative produit un événement structuré, durable, versionné et traçable.

Le MVP utilise PostgreSQL + transactional outbox. Aucun broker distribué n'est requis tant que la charge ne le justifie pas.

## 3. Knowledge Layer

Projection exploitable pour recherche et raisonnement :
- faits structurés ;
- documents autorisés ;
- métriques ;
- chronologie d'événements ;
- provenance ;
- classification de sensibilité.

La Knowledge Layer n'est jamais une nouvelle source de vérité transactionnelle.

## 4. Intelligence Engine

Deux niveaux :

### Niveau déterministe
Règles, KPI, seuils, alertes, tendances calculables.

### Niveau probabiliste
Prévisions, résumés, recommandations, détection d'anomalies, compréhension de documents et assistance conversationnelle.

Le second niveau ne peut être activé que lorsque données, gouvernance et évaluation sont suffisantes.

## 5. Agent Runtime

Un agent IA est traité comme un **principal technique contrôlé**.

Il :
- n'obtient jamais un accès DB direct ;
- utilise des tools/commands explicites ;
- hérite d'un tenant, d'un scope et de permissions ;
- ne peut agir au-delà de la délégation de l'utilisateur ;
- produit une trace d'audit ;
- requiert confirmation humaine pour les classes d'actions à risque.

## Invariants AI-native

- le modèle ne remplace jamais les règles métier ;
- aucune sortie IA n'est une vérité comptable, juridique ou financière par elle-même ;
- aucune donnée cross-tenant n'entre dans un contexte IA sans règle explicite ;
- toute donnée fournie à un modèle conserve une provenance exploitable ;
- l'entraînement sur données tenant identifiables est interdit par défaut ;
- les contenus récupérés sont considérés comme données, jamais comme instructions système ;
- les actions mutantes passent par les APIs/commands du Core ;
- un échec de fournisseur IA ne bloque jamais les parcours transactionnels fondamentaux.

## Conséquence pour Phase 1

Identity & Tenancy doit déjà :
- émettre des événements de domaine ;
- transporter correlation/causation/request IDs ;
- classifier les événements ;
- identifier actor/tenant/establishment ;
- permettre de distinguer humain, système et futur agent ;
- ne contenir aucune dépendance à un fournisseur de modèle.
