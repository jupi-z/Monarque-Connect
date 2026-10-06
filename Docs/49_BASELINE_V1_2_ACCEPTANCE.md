# 49 — Acceptance de la baseline v1.2 AI-Native Foundation

La baseline v1.2 est prête avant Phase 1 si :

## Core

- [x] le Core déterministe reste source de vérité ;
- [x] aucun LLM n'a accès direct à PostgreSQL ;
- [x] les fonctions transactionnelles restent disponibles sans fournisseur IA.

## Event Fabric

- [x] envelope canonique défini ;
- [x] transactional outbox obligatoire pour événements critiques ;
- [x] at-least-once + consumers idempotents ;
- [x] versionnement des événements défini ;
- [x] correlation/causation/request IDs définis ;
- [x] schemas JSON contractuels ajoutés et validés en CI.

## Data Governance

- [x] classification canonique définie ;
- [x] provenance définie ;
- [x] training tenant opt-in=false par défaut ;
- [x] inference et training séparés ;
- [x] cross-tenant identifiable interdit.

## Knowledge

- [x] Knowledge Layer séparée du Core ;
- [x] retrieval pré-filtré par permissions/scopes ;
- [x] contenu externe/documents considéré untrusted ;
- [x] vector store différé jusqu'au besoin.

## AI Gateway

- [x] provider-neutral ;
- [x] structured outputs validés ;
- [x] policy/minimisation avant modèle ;
- [x] coût/latence/metadata observables ;
- [x] failure IA n'arrête pas le Core.

## Agents

- [x] actor AGENT prévu ;
- [x] délégation bornée ;
- [x] aucune escalade autonome ;
- [x] classes d'action A0-A4 ;
- [x] confirmation humaine pour high-impact ;
- [x] mutations idempotentes et auditées.

## Evaluation

- [x] prompt injection incluse au threat model ;
- [x] évaluation versionnée requise avant production ;
- [x] kill switch prévu ;
- [x] model changes soumis à réévaluation.

## Exécution

La Phase 0.5 doit implémenter le socle Event Fabric/provenance avant Phase 1, sans implémenter prématurément un chatbot ou un agent généraliste.
