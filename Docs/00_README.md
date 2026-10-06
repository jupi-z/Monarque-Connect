# Dossier documentaire normatif

**Statut : FROZEN SPECIFICATION BASELINE v1.1**

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
| `32_PRODUCT_MODEL_V1_1.md` | Modèle produit à quatre piliers |
| `33_BUSINESS_TYPES_PLANS_ENTITLEMENTS.md` | Types, plans et droits fonctionnels |
| `34_ESTABLISHMENTS_AND_SCOPE.md` | Établissements et portée d'accès |
| `35_CONTROL_PLANE_SPEC.md` | Control Plane SaaS |
| `36_PURCHASES_CASH_PROJECTS.md` | Achats, caisse et projets légers |
| `37_INTELLIGENCE_SPEC.md` | Intelligence opérationnelle |
| `38_MODULE_CATALOG.md` | Catalogue canonique des modules |

## Gel documentaire

Toute divergence entre code et baseline est un défaut. Une modification du modèle produit, d'un entitlement, d'un invariant, d'un contrat API ou d'une frontière de module exige une modification documentaire explicite et, si structurante, un ADR.
