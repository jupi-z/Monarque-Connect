# Phase 8 Projects & Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer Projects, Tasks et Documents/Media links avec isolation tenant/établissement, contrats API-first et preuves PostgreSQL/E2E complètes.

**Architecture:** Project et Task sont des agrégats relationnels établissement-scopés. Document persiste uniquement les métadonnées et délègue les octets à un adaptateur binaire provider-neutral ; DocumentLink utilise une allowlist de cibles. Les autorisations, idempotences, audit et Outbox réutilisent les primitives centrales existantes.

**Tech Stack:** NestJS, TypeScript, Prisma, PostgreSQL, OpenAPI 3.1, Vitest, Supertest, transactional outbox et `AuthorizationService`.

**Spec:** `Docs/82_PHASE8_PROJECTS_DOCUMENTS_EXECUTION_SPEC.md`

## Global Constraints

- Aucun client n'accède directement à PostgreSQL ou au stockage binaire.
- Toute mutation exige `Idempotency-Key` et compare le hash canonique en rejeu.
- Toute écriture critique état + audit + Outbox est atomique dans PostgreSQL.
- Toute ressource reste filtrée par organization, establishment et scope avant pagination.
- Aucun changement silencieux des invariants ou migrations des Phases 0 à 7.
- Aucun nouveau quota, fournisseur de stockage, workflow juridique ou règle réglementaire sans ADR validé.

## Review Focus

- Une cible Document d'un autre tenant ou établissement doit être introuvable sans fuite ; test dans Task 5.
- Une transition concurrente obsolète doit retourner `409` sans événement parasite ; test dans Task 3.
- Un rejeu de clé avec payload différent doit retourner `409` ; test dans Task 3 et Task 5.
- Un upload incomplet, révoqué ou hors taille doit rester inaccessible ; test dans Task 5.
- Un consumer rejoué ne doit créer ni doublon ni lien supplémentaire ; test dans Task 4.

---

### Task 1: Modèle Prisma et migration additive

**Files:**
- Create: `prisma/migrations/<timestamp>_add_projects_documents/migration.sql`
- Modify: `prisma/schema.prisma`
- Test: `tests/projects/projects.schema.integration.test.ts`

**Interfaces:**
- Produces `Project`, `Task`, `Document`, `DocumentLink`, idempotency records and tenant-qualified relations.
- Consumes existing Organization, Establishment, Membership, Party, Opportunity and audit/outbox relations.

- [ ] Step 1: Écrire les tests PostgreSQL des tables, enums, FK tenant/establishment, unicités et états terminaux.
- [ ] Step 2: Exécuter le test contre la baseline Phase 7 pour vérifier l'échec attendu avant migration.
- [ ] Step 3: Implémenter les modèles Prisma et migration additive sans modifier les migrations historiques.
- [ ] Step 4: Exécuter `npm run prisma:validate` et les tests de schéma sur base vide et upgrade Phase 7.
- [ ] Step 5: Committer `feat(projects): add phase 8 persistence model`.

### Task 2: Autorisations, types métier et transitions

**Files:**
- Modify: `src/tenancy/authorization.service.ts`
- Create: `src/projects/projects.types.ts`
- Create: `src/projects/projects.transitions.ts`
- Test: `tests/projects/projects.authorization.test.ts`
- Test: `tests/projects/projects.transitions.test.ts`

**Interfaces:**
- `AuthorizationService.requireModule(principal, organizationId, moduleCode, permission)` remains the single gate.
- `assertProjectTransition(current, target): void` and `assertTaskTransition(current, target): void` reject invalid transitions with `ConflictException`.

- [ ] Step 1: Écrire les tests de matrice rôle/entitlement/scope et de chaque transition autorisée/interdite.
- [ ] Step 2: Implémenter les permissions centrales `projects:*` et `documents:*` dans la matrice existante.
- [ ] Step 3: Implémenter les guards de transition et les validations de membership/establishment.
- [ ] Step 4: Exécuter les tests unitaires ciblés et les tests d'isolation.
- [ ] Step 5: Committer `feat(projects): centralize phase 8 authorization and transitions`.

### Task 3: Projects et Tasks transactionnels

**Files:**
- Create: `src/projects/project.service.ts`
- Create: `src/projects/task.service.ts`
- Create: `src/projects/projects.controller.ts`
- Create: `src/projects/tasks.controller.ts`
- Create: `src/projects/projects.module.ts`
- Test: `tests/projects/projects.integration.test.ts`
- Test: `tests/e2e/phase8-projects-documents.e2e.test.ts`

**Interfaces:**
- `ProjectService.create(principal, organizationId, input, idempotencyKey): Promise<ProjectView>`
- `ProjectService.list(principal, organizationId, query): Promise<ProjectPage>`
- `ProjectService.transition(principal, organizationId, projectId, input, idempotencyKey): Promise<ProjectView>`
- `TaskService.create/list/update/transition` use the same principal, tenant and idempotency conventions.

- [ ] Step 1: Écrire les tests rouges de création, scope, références Party/Opportunity, transition et rejeu divergent.
- [ ] Step 2: Implémenter les services avec verrouillage d'agrégat et état + audit + Outbox atomiques.
- [ ] Step 3: Ajouter les contrôleurs `AuthGuard` et DTO validés derrière les endpoints contractuels.
- [ ] Step 4: Exécuter les tests PostgreSQL et E2E ciblés ; vérifier `401/403/404/409`.
- [ ] Step 5: Committer `feat(projects): add transactional projects and tasks`.

### Task 4: Adaptateur binaire, Documents et DocumentLinks

**Files:**
- Create: `src/documents/storage-adapter.ts`
- Create: `src/documents/memory-storage.adapter.ts`
- Create: `src/documents/document.service.ts`
- Create: `src/documents/documents.controller.ts`
- Create: `src/documents/documents.module.ts`
- Test: `tests/documents/documents.integration.test.ts`
- Test: `tests/events/documents.consumer.integration.test.ts`

**Interfaces:**
- `StorageAdapter.beginUpload(input): Promise<UploadSession>`
- `StorageAdapter.completeUpload(storageKey, checksumSha256, byteSize): Promise<void>`
- `StorageAdapter.readStream(storageKey): Promise<NodeJS.ReadableStream>`
- `DocumentService.startUpload/complete/revoke/link/unlink` preserve canonical idempotence.

- [ ] Step 1: Écrire les tests rouges de métadonnées sans octets, allowlist de cibles, expiry, completion et révocation.
- [ ] Step 2: Implémenter l'interface et l'adaptateur de test sans choisir de fournisseur.
- [ ] Step 3: Implémenter Documents/Links avec vérification tenant/establishment et événements versionnés.
- [ ] Step 4: Vérifier les rejeux du consumer et l'absence de doublons de liens.
- [ ] Step 5: Committer `feat(documents): add provider-neutral document metadata and links`.

### Task 5: Contrats HTTP et compatibilité cross-phase

**Files:**
- Modify: `openapi/openapi.yaml`
- Modify: `tests/contracts/openapi.contract.test.ts`
- Create: `tests/projects/projects.contracts.test.ts`
- Modify: `Docs/82_PHASE8_PROJECTS_DOCUMENTS_EXECUTION_SPEC.md`

**Interfaces:**
- Les `operationId` et schémas OpenAPI deviennent les interfaces publiques immuables de la Phase 8.

- [ ] Step 1: Écrire les tests de présence des routes, schémas, erreurs, auth, idempotence et allowlist de liens.
- [ ] Step 2: Implémenter le contrat OpenAPI détaillé avant toute modification de contrôleur.
- [ ] Step 3: Valider `npm run openapi:validate` et `npm run contracts:validate`.
- [ ] Step 4: Vérifier que les opérations Phases 0 à 7 restent inchangées et documentées.
- [ ] Step 5: Committer `docs(api): freeze phase 8 projects and documents contract`.

### Task 6: Preuves de migrations, sécurité et non-régression

**Files:**
- Create: `scripts/verify-phase8-migrations.mjs`
- Modify: `.github/workflows/backend-ci.yml` si nécessaire
- Create: `Docs/84_PHASE_8_CLOSURE_EVIDENCE.md` à la clôture uniquement
- Test: `tests/e2e/phase8-projects-documents.e2e.test.ts`

- [ ] Step 1: Ajouter la preuve base vide et upgrade Phase 7, seed idempotent et absence de fixtures opérationnelles.
- [ ] Step 2: Ajouter les tests d'isolation tenant/establishment, concurrence, sécurité binaire et audit/Outbox.
- [ ] Step 3: Exécuter lint, typecheck, Prisma validate, migrations, OpenAPI, contrats, suite PostgreSQL, E2E, build et smoke.
- [ ] Step 4: Ouvrir une PR dédiée, attendre la CI verte, puis fusionner par squash avec SHA attendu.
- [ ] Step 5: Vérifier la CI post-fusion, synchroniser statut/roadmap/tracker/issue et supprimer la branche.

## Notes d'exécution

- Les opérations DocumentLink sont volontairement conservées dans
  `DocumentService` afin que création/retrait du lien, audit et Outbox restent
  dans la même transaction ; aucun service séparé ne doit dupliquer cette
  frontière.
- Le contrôleur expose la route normative
  `POST /organizations/{organizationId}/documents/uploads`, alignée avec la
  spécification plutôt qu'avec le chemin initialement gelé par erreur.
- `scripts/verify-phase8-migrations.mjs` prouve la base vide, l'upgrade depuis
  la dernière migration Phase 7, le seed idempotent et les contraintes Phase 8.
- La migration et les tests PostgreSQL ont été ajoutés, mais leur succès
  effectif reste à prouver par la CI tant que PostgreSQL n'est pas disponible
  dans l'environnement local.
