# 23 — ADR Register

| ADR | Décision | Statut |
|---|---|---|
| ADR-001 | Monolithe modulaire | Accepted |
| ADR-002 | REST + OpenAPI 3.1 contract-first | Accepted |
| ADR-003 | PostgreSQL source de vérité | Accepted |
| ADR-004 | Clients dans dépôts séparés | Accepted |
| ADR-005 | Aucun ERP/CRM framework tiers comme base | Accepted |
| ADR-006 | API stateless | Accepted |
| ADR-007 | Multi-tenant partagé avec `organization_id` | Accepted |
| ADR-008 | Isolation applicative obligatoire, RLS différée | Accepted |
| ADR-009 | S3-compatible pour binaires | Accepted |
| ADR-010 | Pas de Redis/broker/search dédié en MVP | Accepted |
| ADR-011 | PaymentRecord = constat d'encaissement, pas gateway | Accepted |
| ADR-012 | Backend owner `@jupi-z` | Accepted |
| ADR-013 | Produit structuré en Network + Business OS + Intelligence + Control Plane | Accepted |
| ADR-014 | Business type = preset extensible, jamais mécanisme d'autorisation | Accepted |
| ADR-015 | Plan + overrides = entitlement effectif | Accepted |
| ADR-016 | Activation module séparée de l'entitlement | Accepted |
| ADR-017 | Chaque organisation possède un établissement principal | Accepted |
| ADR-018 | Ressources opérationnelles établissement-scopées | Accepted |
| ADR-019 | Capabilities endpoint pour clients, sans délégation de sécurité | Accepted |
| ADR-020 | Achats, caisse et projets légers font partie du MVP Business OS | Accepted |
| ADR-021 | Intelligence démarre déterministe ; capacités probabilistes activées uniquement derrière les gates de gouvernance/évaluation | Accepted |
| ADR-022 | Control Plane fait partie du backend propriétaire, avec rôles plateforme séparés | Accepted |
| ADR-023 | NetworkInquiry est le pont Network → CRM | Accepted |
| ADR-024 | Pas d'ERPNext/Frappe ni d'adapter de compatibilité dans l'architecture cible | Accepted |
| ADR-025 | Network trust MVP = vérification + credentials publiés, sans score réputationnel opaque | Accepted |
| ADR-026 | Portabilité/export des données tenant = capacité core non premium | Accepted |
| ADR-027 | Localisation RDC séparée du core ; conformité réglementaire seulement après validation spécialisée | Accepted |
| ADR-028 | Monarque Connect est AI-native mais le Core transactionnel reste déterministe | Accepted |
| ADR-029 | Transactional outbox = fondation obligatoire des événements métier critiques | Accepted |
| ADR-030 | PostgreSQL Event Fabric au MVP ; broker distribué différé | Accepted |
| ADR-031 | Knowledge Layer = projection reconstruisible, jamais source de vérité | Accepted |
| ADR-032 | AI Gateway provider-neutral obligatoire pour toute inference | Accepted |
| ADR-033 | Aucun SDK IA fournisseur dans les modules métier | Accepted |
| ADR-034 | Inference et training sont séparés ; training tenant opt-in=false par défaut | Accepted |
| ADR-035 | Agent = principal technique délégué, sans accès DB direct | Accepted |
| ADR-036 | Actions agentiques high-impact exigent confirmation humaine et revalidation | Accepted |
| ADR-037 | Vector store/embeddings différés jusqu'à besoin démontré | Accepted |

| ADR-038 | FairScale V1 : fonctions, capacités et facturation SaaS séparées ; phases 9.5/9.6 | Accepted — implémentation en attente ([détail](94_ADR_038_FAIRSCALE.md)) |
