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

## Tables principales

### users
`id`, `email`, `phone?`, `password_hash`, `first_name`, `last_name`, `status`, timestamps. Unique email normalisé.

### refresh_sessions
`id`, `user_id`, `family_id`, `token_hash`, `expires_at`, `revoked_at?`, `replaced_by?`, metadata de sécurité.

### organizations
`id`, `name`, `legal_name?`, `handle`, `default_currency`, `status`, timestamps. Unique `handle`.

### memberships
`id`, `organization_id`, `user_id`, `role`, `status`, timestamps. Unique `(organization_id,user_id)`.

### invitations
`id`, `organization_id`, `email`, `role`, `token_hash`, `expires_at`, `accepted_at?`, `created_by`.

### business_parties
`id`, `organization_id`, `type`, `display_name`, `email?`, `phone?`, `tax_id?`, `linked_organization_id?`, `notes?`, timestamps.

### items
`id`, `organization_id`, `type`, `sku?`, `name`, `description?`, `unit`, `reference_price`, `currency`, `track_inventory`, `active`.

### warehouses / stock_movements
Les mouvements sont append-only et tenant-scoped.

### leads / opportunities
CRM tenant-scoped avec owner membership optionnel.

### quotes / sales_orders / invoices
Headers + lines snapshotées ; numérotation unique par organisation ; documents émis non réécrits silencieusement.

### payment_records / expenses
Montants exacts, devise, idempotence, audit.

### organization_profiles / connection_requests / business_connections
Projection publique et relations B2B séparées des données privées.

### conversations / messages
Conversation entre organisations autorisées ; messages immuables et idempotents.

### documents / media_objects
Métadonnées en DB, binaire en object storage.

### audit_events / outbox_events / idempotency_keys
Append-only pour audit/outbox ; clés d'idempotence scoped par tenant/opération.

## Isolation
Toutes les tables métier tenantées portent `organization_id`. Une table sans tenant doit être explicitement justifiée.
