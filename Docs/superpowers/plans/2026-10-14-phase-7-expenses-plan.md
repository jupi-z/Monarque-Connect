# Phase 7 Task 4 — Expenses Implementation Plan

> Plan d’exécution de la tranche Expenses. La spécification normative est
> `Docs/79_PHASE_7_EXPENSES_EXECUTION_SPEC.md`.

**Goal:** Livrer le cycle de vie Expense `DRAFT → RECORDED → VOID` avec
isolation tenant/établissement, idempotence, audit et Outbox atomiques.

**Baseline:** `main@e001596c88fd31c9fa72d7c91547f140242c349a`.

**Issue:** [#92](https://github.com/jupi-z/Monarque-Connect/issues/92).

## Séquence

### 1. Contrat et frontière

- [x] Figer la frontière Project/Document/Cash : aucune pseudo-référence sans
  modèle propriétaire.
- [ ] Ajuster OpenAPI pour refléter les champs réellement supportés en v1.
- [ ] Ajouter les permissions et contrats de réponse manquants dans les tests.

### 2. Tests d’abord

- [ ] Ajouter les tests PostgreSQL du cycle de vie et des transitions illégales.
- [ ] Ajouter les tests d’immuabilité `RECORDED`, motif `VOID` et idempotence.
- [ ] Ajouter tenant isolation, establishment scope et Party inter-tenant.
- [ ] Ajouter le test de rollback état + audit + Outbox.

### 3. Modèle et migration

- [ ] Ajouter `ExpenseStatus`, les actions d’audit et le modèle Expense.
- [ ] Ajouter la migration additive et ses contraintes composites.
- [ ] Vérifier Prisma, migration base vide et upgrade Phase 6.

### 4. Service et HTTP

- [ ] Implémenter list/get/create/update/record/void.
- [ ] Appliquer systématiquement autorisation, module, permission et scope.
- [ ] Émettre les événements versionnés dans la transaction métier.
- [ ] Enregistrer les commandes d’idempotence avec empreinte canonique.

### 5. Vérification et livraison

- [ ] Exécuter ciblé puis non-régression complète.
- [ ] Mettre à jour `Docs/78_PHASE_7_STATUS.md` et issue #84 uniquement avec
  des preuves CI effectives.
- [ ] Ouvrir une PR dédiée, attendre CI verte, squash-merger et supprimer la
  branche locale et distante.

## Contraintes de conception

- aucun modèle Project/Document/Cash anticipé ;
- aucun mouvement de caisse créé dans cette tranche ;
- aucune modification des migrations historiques ;
- aucun push direct sur `main` ;
- aucun gate marqué vert sans sortie ou URL vérifiable.
