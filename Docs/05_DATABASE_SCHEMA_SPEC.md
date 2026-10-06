# 05 — Schéma de données normatif

## Conventions

- PostgreSQL 17.
- `uuid` pour PK publiques.
- `timestamptz` UTC.
- argent : `numeric(19,4)` + `char(3)` currency.
- quantité : `numeric(19,6)`.
- `created_at`, `updated_at` sur agrégats mutables.
- contraintes DB pour les invariants structuraux.
- migrations additives.
- toutes les ressources opérationnelles portent `organization_id`.
- toute ressource opérationnelle localisée porte `establishment_id`.

## Identity & tenancy

### users
`id`, `email`, `phone?`, `password_hash`, `first_name`, `last_name`, `status`, timestamps. Unique email normalisé.

### refresh_sessions
`id`, `user_id`, `family_id`, `token_hash`, `expires_at`, `revoked_at?`, `replaced_by?`, metadata de sécurité.

### business_types
`code`, `name`, `description?`, `active`, `sort_order`. Codes seedés, extensibles sans migration d'enum.

### organizations
`id`, `business_type_code`, `name`, `legal_name?`, `handle`, `default_currency`, `status`, timestamps. Unique `handle`.

### establishments
`id`, `organization_id`, `code`, `name`, `type`, `is_primary`, adresse structurée optionnelle, `status`, timestamps.  
Unique `(organization_id, code)`. Une seule ligne `is_primary=true` par organisation.

### memberships
`id`, `organization_id`, `user_id`, `role`, `scope_mode`, `status`, timestamps. Unique `(organization_id,user_id)`.

`scope_mode = ALL_ESTABLISHMENTS | SELECTED_ESTABLISHMENTS`.

### membership_establishment_scopes
`membership_id`, `establishment_id`. Utilisé uniquement pour `SELECTED_ESTABLISHMENTS`. Contrainte : membership et establishment doivent appartenir à la même organization.

### invitations
`id`, `organization_id`, `email`, `role`, `scope_mode`, `token_hash`, `expires_at`, `accepted_at?`, `created_by`.

## Product catalog / plans / entitlements

### module_definitions
`code`, `name`, `pillar`, `availability`, `dependencies_json`, `active`, timestamps.  
`code` est stable et utilisé par les APIs/clients.

### business_type_module_presets
`business_type_code`, `module_code`, `default_activation`, `priority`.  
Ne confère aucun droit : preset uniquement.

### plans
`id`, `code`, `name`, `version`, `status`, timestamps.  
Une version de plan n'est pas réécrite après utilisation commerciale ; nouvelle version pour changement structurel.

### plan_modules
`plan_id`, `module_code`, `allowed`, `default_enabled`, `limits_json`.

### organization_subscriptions
`id`, `organization_id`, `plan_id`, `status`, `starts_at`, `ends_at?`, `managed_service`, timestamps. Une seule subscription active effective à un instant donné.

### organization_entitlements
`id`, `organization_id`, `module_code`, `effect`, `limits_json?`, `starts_at`, `ends_at?`, `reason`, `created_by_platform_user_id`.  
`effect = ALLOW | DENY | LIMIT_OVERRIDE`.

### organization_module_activations
`organization_id`, `module_code`, `enabled`, `configured_at`, `configured_by`.

### quota_usages
`organization_id`, `quota_code`, `period_key`, `used_value`, `updated_at`.  
Le quota ne constitue jamais la seule source historique de facturation.

## Parties & catalogue

### business_parties
`id`, `organization_id`, `type`, `display_name`, `email?`, `phone?`, `tax_id?`, `linked_organization_id?`, `notes?`, timestamps.

### items
`id`, `organization_id`, `type`, `sku?`, `name`, `description?`, `unit`, `reference_price`, `currency`, `track_inventory`, `active`.

### warehouses
`id`, `organization_id`, `establishment_id`, `code`, `name`, `active`.

### stock_movements
`id`, `organization_id`, `establishment_id`, `warehouse_id`, `item_id`, `direction`, `reason`, `quantity`, `reference_type?`, `reference_id?`, `created_by`, `created_at`. Append-only.

## CRM

### leads / opportunities
Tenant-scoped. `establishment_id` obligatoire pour opportunity opérationnelle ; lead peut être organization-wide pendant qualification.  
Une opportunity peut référencer `network_inquiry_id`, `party_id` et `project_id?`.

## Sales

### quotes / quote_lines
Header : `organization_id`, `establishment_id`, numéro, party, status, currency, dates, snapshots, totals. Numéro unique par organization ou établissement selon politique de numérotation configurée.

### sales_orders / sales_order_lines
Même principe. Référence au quote source optionnelle.

### invoices / invoice_lines
Même principe. `issued_at?`, `due_at?`, totaux figés.

### payment_records
`id`, `organization_id`, `establishment_id`, `invoice_id`, `amount`, `currency`, `method`, `reference?`, `paid_at`, `status`, `recorded_by`. Idempotence requise.

## Purchases

### supplier_rfqs
`id`, `organization_id`, `establishment_id`, `number`, `status`, `needed_by?`, `created_by`, timestamps.

### supplier_rfq_recipients
`rfq_id`, `party_id?`, `network_organization_id?`, `status`. Exactement une cible par recipient.

### supplier_rfq_lines
Snapshot item/description, quantity, unit.

### purchase_orders / purchase_order_lines
Tenant + establishment + supplier party/network link, snapshots, status, currency, totals.

### goods_receipts / goods_receipt_lines
Tenant + establishment + purchase order, warehouse, quantities reçues. Confirmation crée les stock movements de manière idempotente.

## Expenses & cash

### expenses
`id`, `organization_id`, `establishment_id`, `category`, `description`, `amount`, `currency`, `spent_at`, `party_id?`, `project_id?`, `document_id?`, `status`, `created_by`.

### cash_accounts
`id`, `organization_id`, `establishment_id`, `code`, `name`, `currency`, `status`. Unique `(organization_id, code)`.

### cash_movements
`id`, `organization_id`, `establishment_id`, `cash_account_id`, `direction`, `amount`, `currency`, `reason`, `reference_type?`, `reference_id?`, `occurred_at`, `created_by`. Append-only ; correction par mouvement compensatoire.

## Projects

### projects
`id`, `organization_id`, `establishment_id`, `code`, `name`, `status`, `party_id?`, `opportunity_id?`, `starts_at?`, `due_at?`, timestamps.

### project_tasks
`id`, `organization_id`, `project_id`, `title`, `status`, `assignee_membership_id?`, `due_at?`, timestamps.

## Network

### organization_profiles
Projection publique explicitement activée.

### organization_verifications
`organization_id`, `status`, `level?`, `verified_at?`, `expires_at?`, `reviewed_by_platform_user_id?`, `internal_reason?`.  
Les preuves sensibles de vérification ne sont jamais exposées directement dans le profil public.

### published_credentials
`id`, `organization_id`, `title`, `issuer?`, `reference?`, `valid_from?`, `expires_at?`, `document_id?`, `public`.  
Seuls les credentials `public=true` sont exposables.

### connection_requests / business_connections
Relations B2B entre organizations.

### network_inquiries
`id`, `from_organization_id`, `to_organization_id`, `subject`, `message`, `status`, `converted_lead_id?`, `converted_opportunity_id?`, timestamps.

### conversations / messages
Conversation entre organizations autorisées ; message avec auteur user + organization ; idempotence via client message id.

## Intelligence

### metric_snapshots
`id`, `organization_id`, `establishment_id?`, `metric_code`, `period_start`, `period_end`, `value_numeric?`, `value_json?`, `calculated_at`.

### insight_rules
`id`, `code`, `module_code`, `rule_version`, `active`, configuration déterministe.

### insight_alerts
`id`, `organization_id`, `establishment_id?`, `rule_code`, `severity`, `status`, `payload_json`, `triggered_at`, `resolved_at?`.

## Documents / platform

### documents / media_objects
Métadonnées en DB, binaire en object storage.

### data_exports
`id`, `organization_id`, `requested_by_membership_id`, `status`, `format`, `object_key?`, `manifest_version`, `requested_at`, `ready_at?`, `expires_at?`, `failure_code?`.  
Aucun secret d'authentification n'est exporté. Le fichier généré reste privé et expire.

### audit_events / outbox_events / idempotency_keys
Append-only pour audit/outbox ; clés d'idempotence scoped par actor/tenant/opération.

## Isolation et intégrité

- une FK métier ne peut pas relier silencieusement deux tenants ;
- toute table établissement-scopée doit vérifier cohérence `organization_id ↔ establishment_id` ;
- les relations réseau sont les seules relations cross-organization explicitement autorisées ;
- les entitlements et scopes sont testés en base réelle via E2E.

## AI-native foundation

### outbox_events

L'Outbox devient un composant de fondation, pas uniquement une future intégration.

Champs minimaux :
`id`, `event_type`, `event_version`, `organization_id?`, `establishment_id?`, `actor_type`, `actor_id?`, `aggregate_type`, `aggregate_id`, `correlation_id`, `causation_id?`, `request_id?`, `data_classification`, `purpose`, `payload_json`, `occurred_at`, `recorded_at`, `status`, `attempts`, `next_attempt_at?`, `locked_at?`, `locked_by?`, `processed_at?`, `last_error_code?`, `last_error_message?`.

Index :
- `(status, next_attempt_at)` ;
- `(organization_id, occurred_at)` ;
- `(aggregate_type, aggregate_id, occurred_at)` ;
- `correlation_id`.

Le payload ne contient jamais password, token, secret ou dump ORM complet.

### event_consumer_receipts

`id`, `consumer_name`, `event_id`, `processed_at`.  
Contrainte unique `(consumer_name, event_id)` afin de rendre les consumers DB internes idempotents.

Le comportement de claim, lease, retry, FAILED et replay est figé dans `50_EVENT_FABRIC_IMPLEMENTATION_SPEC.md`.

### organization_ai_policies

Prépare les futures features IA sans les activer automatiquement :

`organization_id`, `ai_features_enabled`, `external_model_processing_allowed`, `allowed_data_classes_json`, `training_opt_in` default false, `retention_preference?`, `updated_by`, `updated_at`.

La policy ne peut jamais élargir les permissions utilisateur ni rendre légale une utilisation autrement interdite.

### knowledge_records — future/projection

Table ou datastore de projection futur, créée uniquement quand la première feature de retrieval le nécessite.

Conceptuellement :
`id`, `organization_id`, `establishment_id?`, `source_type`, `source_id`, `source_version_hash`, `content_type`, `data_classification`, `purpose`, `projection_json`, `valid_from`, `valid_to?`, timestamps.

Ce datastore est reconstruisible depuis les sources autorisées.

### ai_inference_runs — future runtime

Metadata uniquement :
`id`, `organization_id`, `initiating_user_id?`, `feature_code`, `provider`, `model_id`, `model_policy_version`, `correlation_id`, `input_classification`, `status`, `latency_ms?`, `input_units?`, `output_units?`, `estimated_cost?`, `started_at`, `completed_at?`.

Les prompts/réponses bruts ne sont pas stockés par défaut.

### agent_action_proposals / agent_action_executions — future runtime

Préparent un audit fort des agents :
- initiating user ;
- agent definition/version ;
- tenant/establishment ;
- tool/command ;
- arguments hash + représentation filtrée ;
- action class ;
- confirmation status ;
- idempotency key ;
- result/status ;
- correlation/request IDs.

## Règle d'introduction

Seule `outbox_events` est requise dès les premières verticales. Les tables Knowledge/Inference/Agent sont créées lorsque les features correspondantes entrent réellement en implémentation afin d'éviter une infrastructure morte prématurée.
