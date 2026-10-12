# Phase 4 CRM + Network Opening Plan

> **Execution status:** opening complete when this plan is merged with the Phase 4 specification and status documents. No Phase 4 business endpoint is implemented by this opening plan.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ouvrir proprement la Phase 4 — CRM + Network entry, figer son périmètre et ses gates, puis préparer une exécution par tranches courtes, auditées et API-first.

**Architecture:** CRM, Network et leurs projections publiques réutilisent les contrôles existants d'identité, d'entitlements, d'activation, de permissions, de scope, d'audit et d'Outbox. Les relations Network autorisent uniquement des projections explicites et ne donnent jamais accès au tenant partenaire.

**Tech Stack:** NestJS 12, TypeScript strict, Prisma 7, PostgreSQL 17, OpenAPI YAML, Vitest, Supertest, GitHub Actions.

**Spec:** `Docs/64_PHASE4_CRM_NETWORK_EXECUTION_SPEC.md`

## Global constraints

- Toute requête suit `tenant actif → membership actif → entitlement → activation → permission → scope établissement`.
- Toute mutation significative écrit état, audit et Outbox dans la même transaction Prisma.
- Les routes publiques sont read-only, opt-in, allowlistées et sans fuite cross-tenant.
- Aucun score réputationnel opaque, avis public, recherche full-text dédiée ou messagerie n'est inclus dans l'ouverture.
- Les branches sont courtes, les PR sont obligatoires, la CI doit être verte et le merge se fait par squash.
- Aucun fichier de progression local ou artefact développeur-only n'est committé.

---

### Task 1: Ouvrir et synchroniser le cadrage

**Files:**
- Create: `Docs/64_PHASE4_CRM_NETWORK_EXECUTION_SPEC.md`
- Create: `Docs/65_PHASE_4_STATUS.md`
- Create: `Docs/superpowers/plans/2026-10-12-phase-4-crm-network-opening.md`
- Modify: `Docs/00_README.md`
- Modify: `Docs/21_EXECUTION_ROADMAP.md`
- Modify: `README.md`

- [x] Relire le roadmap et les contrats normatifs CRM/Network existants.
- [x] Définir le périmètre et les exclusions sans annoncer de livraison métier.
- [x] Déclarer les invariants d'autorisation, d'isolation, d'audit et d'idempotence.
- [x] Définir les gates de sortie et les décisions ouvertes.
- [ ] Faire relire et valider le contrat détaillé avant toute migration métier.

### Task 2: Figer les contrats CRM/Network avant code

**Files:**
- Modify: `openapi/openapi.yaml`
- Create/Modify: `prisma/schema.prisma`
- Modify: `src/tenancy/authorization.service.ts`
- Test: `tests/tenancy/authorization.policy.test.ts`
- Test: `tests/crm/*.integration.test.ts`
- Test: `tests/network/*.integration.test.ts`

- [x] Écrire les tests de permissions, d'entitlements, d'activation et de scope.
- [x] Figer les états, transitions, règles de visibilité et policy de contact.
- [x] Définir les schémas OpenAPI complets, erreurs, pagination et idempotence.
- [x] Définir les événements, classifications, audit et contraintes concurrentes.
- [x] Vérifier les décisions ouvertes dans la spécification avant migration ; indexation publique et quotas Network restent explicitement différés avant leur migration.

**Ruling:** le modèle Prisma et les migrations sont différés aux tâches CRM et
Network dédiées. La matrice d'autorisation et les contrats API peuvent être
gelés sans créer de tables vides ; le coût si cette séparation est erronée est
un changement contractuel avant migration, limité et détectable par les tests
OpenAPI/Prisma.

### Task 3: Implémenter le CRM fondation

- [x] Implémenter leads et opportunités avec contrôle partagé.
- [x] Implémenter les transitions idempotentes et audit/outbox transactionnels.
- [x] Ajouter isolation tenant, scope établissement et tests PostgreSQL de concurrence.
- [x] Publier les contrats OpenAPI et tests HTTP PostgreSQL correspondants.

**Preuve de tranche :** `Docs/66_PHASE_4_CRM_FOUNDATION_EVIDENCE.md`.

### Task 4: Implémenter le Network entry

- [ ] Implémenter profil public opt-in et projection allowlistée.
- [ ] Implémenter vérification/trust sous autorité plateforme et audit.
- [ ] Implémenter découverte paginée sans fuite de données privées.
- [ ] Implémenter connexions et `NetworkInquiry` avec règles de contact.
- [ ] Prouver les protections cross-tenant et les transitions concurrentes.

### Task 5: Relier NetworkInquiry au CRM

- [ ] Implémenter la conversion atomique et idempotente vers Lead/Opportunity.
- [ ] Préserver la provenance et la référence à l'inquiry source.
- [ ] Tester les retries, conflits, doublons et événements uniques.

### Task 6: Clôturer strictement la Phase 4

- [ ] Prouver migration base vide et upgrade depuis Phase 3.
- [ ] Exécuter tests PostgreSQL, E2E, OpenAPI, contrats, lint, typecheck et build.
- [ ] Répéter les contrôles sur le commit `main` après merge.
- [ ] Créer la preuve de clôture avec URLs GitHub observées.
- [ ] Synchroniser issue #49 et tracker #11 seulement après tous les gates.
- [ ] Squash-merger les PR et supprimer les branches de livraison.

## Self-review

- Le plan sépare explicitement l'ouverture documentaire de l'implémentation métier.
- Les décisions et contrats précèdent les migrations et les endpoints.
- Les phases Sales, Purchases, Operations et Messaging restent hors périmètre.
- Les contrôles existants sont réutilisés ; aucun moteur d'autorisation parallèle n'est prévu.
