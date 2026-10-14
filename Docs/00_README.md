# Dossier documentaire normatif

**Statut : FROZEN SPECIFICATION BASELINE v1.2 — AI-Native Foundation**

Ce dossier constitue la source de vérité fonctionnelle, architecturale et opérationnelle de Monarque Connect.

## Documents

| Fichier | Autorité |
|---|---|
| `01_PRODUCT_SCOPE_AND_INVARIANTS.md` | Périmètre et invariants |
| `02_SYSTEM_ARCHITECTURE.md` | Architecture |
| `03_TECH_STACK_VERSION_POLICY.md` | Stack |
| `04_DOMAIN_MODEL.md` | Modèle métier |
| `05_DATABASE_SCHEMA_SPEC.md` | Données et contraintes |
| `06_API_CONTRACT_GOVERNANCE.md` | Gouvernance API |
| `07_AUTHORIZATION_MATRIX.md` | RBAC |
| `08_AUTH_AND_SESSION_SECURITY.md` | Auth |
| `09_TENANCY_ISOLATION.md` | Isolation multi-tenant |
| `10_COMMERCIAL_WORKFLOWS.md` | CRM / vente |
| `11_NETWORK_AND_MESSAGING.md` | Réseau B2B |
| `12_DOCUMENTS_AND_MEDIA.md` | Fichiers |
| `13_ERRORS_IDEMPOTENCY_PAGINATION.md` | HTTP |
| `14_SECURITY_BASELINE_THREAT_MODEL.md` | Sécurité |
| `15_TEST_STRATEGY.md` | Tests |
| `16_OBSERVABILITY_AND_AUDIT.md` | Exploitation |
| `17_ENVIRONMENTS_CONFIG_SECRETS.md` | Config |
| `18_MIGRATIONS_BACKUP_RECOVERY.md` | Données |
| `19_CI_CD_RELEASE.md` | Delivery |
| `20_DEFINITION_OF_DONE.md` | Fin MVP |
| `21_EXECUTION_ROADMAP.md` | Ordre de réalisation |
| `22_WORKSTREAM_OWNERSHIP.md` | Répartition |
| `23_ADR_REGISTER.md` | Décisions |
| `24_API_FIRST_RULES.md` | API-first |
| `25_NON_FUNCTIONAL_REQUIREMENTS.md` | NFR |
| `26_GLOSSARY.md` | Vocabulaire |
| `27_REQUIREMENTS_TRACEABILITY.md` | Traçabilité |
| `28_CLIENT_INTEGRATION_CONTRACT.md` | Règles clients |
| `29_FUTURE_EXTENSION_MAP.md` | Extensions |
| `30_GITHUB_GOVERNANCE.md` | GitHub |
| `31_BOOTSTRAP_CHECKLIST.md` | Bootstrap |
| `32_PRODUCT_MODEL.md` | Modèle produit à quatre piliers |
| `33_BUSINESS_TYPES_PLANS_ENTITLEMENTS.md` | Types, plans et droits fonctionnels |
| `34_ESTABLISHMENTS_AND_SCOPE.md` | Établissements et portée d'accès |
| `35_CONTROL_PLANE_SPEC.md` | Control Plane SaaS |
| `36_PURCHASES_CASH_PROJECTS.md` | Achats, caisse et projets légers |
| `37_INTELLIGENCE_SPEC.md` | Intelligence opérationnelle |
| `38_MODULE_CATALOG.md` | Catalogue canonique des modules |
| `40_RDC_LOCALIZATION_BOUNDARY.md` | Localisation RDC et frontière de conformité |
| `41_DATA_PORTABILITY_AND_EXPORT.md` | Portabilité et export tenant |
| `42_AI_NATIVE_FOUNDATION.md` | Architecture AI-native |
| `43_DOMAIN_EVENT_CONTRACT.md` | Event Fabric et contrat événementiel |
| `44_DATA_PROVENANCE_CLASSIFICATION_AI_POLICY.md` | Provenance, classification et policy IA |
| `45_KNOWLEDGE_LAYER_AND_RETRIEVAL.md` | Knowledge Layer / retrieval |
| `46_AI_GATEWAY_AND_MODEL_GOVERNANCE.md` | AI Gateway et gouvernance modèles |
| `47_AGENT_RUNTIME_AND_ACTION_POLICY.md` | Agents et politique d'action |
| `48_AI_SECURITY_AND_EVALUATION.md` | Sécurité et évaluation IA |
| `49_BASELINE_V1_2_ACCEPTANCE.md` | Acceptance AI-native v1.2 |
| `50_EVENT_FABRIC_IMPLEMENTATION_SPEC.md` | Spécification d'implémentation Event Fabric Phase 0.5 |
| `51_SECURITY_EXCEPTION_REGISTER.md` | Registre des exceptions sécurité dépendances |
| `52_EVENT_FABRIC_OPERATIONS.md` | Exploitation Event Fabric |
| `53_PHASE_0_5_STATUS.md` | État et preuves de livraison Phase 0.5 |
| `54_PHASE1_IDENTITY_TENANCY_EXECUTION_SPEC.md` | Spécification d'exécution Phase 1 |
| `55_SEED_AND_REFERENCE_DATA_BASELINE.md` | Baseline des seeds et données de référence |
| `60_PHASE3_REFERENTIALS_EXECUTION_SPEC.md` | Spécification d'exécution Phase 3 |
| `61_PHASE_3_STATUS.md` | État et statut de clôture Phase 3 |
| `62_PHASE_3_CLOSURE_EVIDENCE.md` | Preuves de clôture Phase 3 |
| `63_CROSS_PHASE_STABILIZATION_EVIDENCE.md` | Preuves de stabilisation cross-phase |
| `64_PHASE4_CRM_NETWORK_EXECUTION_SPEC.md` | Spécification d'exécution Phase 4 |
| `65_PHASE_4_STATUS.md` | État d'ouverture Phase 4 |
| `66_PHASE_4_CRM_FOUNDATION_EVIDENCE.md` | Preuves de la tranche CRM fondation Phase 4 |
| `67_PHASE_4_NETWORK_PROFILE_EVIDENCE.md` | Preuves de la tranche profil Network Phase 4 |
| `68_PHASE_4_NETWORK_TRUST_DISCOVERY_EVIDENCE.md` | Preuves de la tranche trust et discovery Network Phase 4 |
| `82_PHASE8_PROJECTS_DOCUMENTS_EXECUTION_SPEC.md` | Spécification d'exécution Phase 8 |
| `83_PHASE_8_STATUS.md` | Statut et gates Phase 8 |

## Gel documentaire

Toute divergence entre code et baseline est un défaut. Une modification du modèle produit, d'un entitlement, d'un invariant, d'un contrat API ou d'une frontière de module exige une modification documentaire explicite et, si structurante, un ADR.
