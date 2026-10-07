# Phase 1 Identity & Tenancy — Design

## Decision

Phase 1 is delivered as a sequence of short-lived pull requests on top of `main`. The first implementation slice establishes the database model, seedable reference data, transaction boundary, and the authorization context primitives. HTTP authentication and the client-facing onboarding flow follow in separate slices so that each change remains reviewable and deployable.

The application uses Prisma as the standard transaction boundary for identity and tenant use-cases. The existing `pg` event worker remains responsible for low-level outbox claiming and dispatch. Domain state changes and their outbox event are committed through the same Prisma transaction client.

## Security model

Every private use-case resolves a request context in this order:

`authenticated user → active membership → organization status → role → establishment scope → capability`

An organization or establishment identifier supplied by the client is only a selector. It never proves authority. Repositories accept an authorization context and apply tenant/scope predicates before loading aggregates. A missing context, inactive user, suspended membership, inactive organization, insufficient role, or inaccessible establishment produces a controlled authorization failure without existence leakage.

Access tokens carry identity/session metadata only. Current membership, role, scope, entitlement, and organization status are re-read for each private action. Refresh tokens are opaque, stored only as hashes, rotated once, and replay of a replaced token revokes its complete family.

## Phase 1 data model

The first migration adds:

- `users` and `refresh_sessions`;
- `business_types`;
- `organizations` and `establishments`;
- `memberships` and `membership_establishment_scopes`;
- `invitations`;
- role/scope/status enums and audit events.

Reference codes remain strings in database tables where extensibility is required. Roles and lifecycle statuses use enums where the value is a closed security contract. A unique partial index enforces one primary establishment per organization; composite foreign keys enforce that a selected establishment belongs to the same organization as its membership.

Organization creation creates the organization, primary establishment, owner membership, and corresponding outbox event in one transaction. No event is written in a follow-up transaction.

## HTTP contract

The first public flow is:

`POST /auth/register` → `POST /auth/login` → `GET /auth/me` → `GET /organizations` → `GET /organizations/{organizationId}/establishments` → `GET /organizations/{organizationId}/capabilities`.

Responses use explicit schemas and RFC 9457 problem details. The contract documents authentication, session rotation, active membership, accessible establishments, and effective capabilities without exposing password hashes, refresh tokens, or internal authorization state.

## Audit and events

Sensitive actions produce both an append-only audit row and a domain event in the same transaction: registration, login/session rotation/replay revocation, organization creation/update, establishment changes, membership/invitation changes, and authorization-sensitive status changes. Audit metadata is bounded and never contains passwords, raw tokens, or private tenant payloads.

## Delivery gates

Each slice must include unit/integration tests, migration validation from an empty database, OpenAPI validation when the public contract changes, lint/typecheck/build, and a PR review. Phase 1 is not closed until cross-tenant and cross-establishment denial is proven against real PostgreSQL and CI is green.
