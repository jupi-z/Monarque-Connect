# Phase 2 Product Entitlements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the authoritative Product Entitlements Control Plane defined by `Docs/57_PHASE2_PRODUCT_ENTITLEMENTS_EXECUTION_SPEC.md`.

**Architecture:** Keep catalog and plan versions immutable, resolve effective entitlements through a dedicated service, and enforce the result after Phase 1 identity/tenancy authorization. Persist all mutations in Prisma transactions with audit and Outbox events; use PostgreSQL constraints and atomic updates for quota safety.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Vitest, Supertest, OpenAPI, GitHub Actions.

## Delivery slices

1. Catalog and immutable plan versions, with idempotent reference seed.
2. Organization subscriptions and deterministic lifecycle transitions.
3. Effective entitlement resolver and versioned capabilities contract.
4. Module activation endpoint with permission, entitlement, dependency and audit enforcement.
5. Quotas with atomic reservation/consumption and concurrent integration tests.
6. OpenAPI, HTTP E2E, migration/upgrade proof, documentation and PR closure.

Every slice follows failing test → minimal implementation → full suite → PR review. No commercial endpoint may use the Phase 1 empty module projection as an authorization decision.
