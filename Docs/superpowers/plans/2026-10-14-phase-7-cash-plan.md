# Phase 7 Task 5 — Cash implementation plan

**Spec:** `Docs/80_PHASE_7_CASH_EXECUTION_SPEC.md`  
**Issue:** [#95](https://github.com/jupi-z/Monarque-Connect/issues/95)  
**Baseline:** `main@51878617729d938ec036b25334d119f0c4e68a5a`

## Constraints

- branche dédiée → PR → CI verte → squash merge → suppression de branche ;
- aucun push direct sur `main` ;
- aucun changement silencieux dans Sales, Purchases, Inventory ou Expenses ;
- aucun moteur de solde mutable, comptable ou fiscal ;
- aucune conversion de devise ni obligation réglementaire inventée.

## Séquence

### 1. Contract freeze

- [ ] écrire les tests de contrat pour comptes, balances, mouvements,
  corrections, transferts et erreurs ;
- [ ] détailler OpenAPI, permissions `cash:read/write`, Problem Details et
  décimaux sérialisés en chaînes ;
- [ ] vérifier que les routes réutilisent l'autorisation centrale Operations ;
- [ ] fusionner le contrat avant le schéma et la migration.

### 2. Account model

- [ ] ajouter `CashAccount` avec clés tenant-qualified, devise, code unique et
  état `ACTIVE|INACTIVE` ;
- [ ] ajouter les actions d'activation/inactivation idempotentes ;
- [ ] couvrir scopes, entitlements, isolation et audit/Outbox.

### 3. Append-only cash ledger

- [ ] ajouter `CashMovement`, sources, corrections et liens de transfert ;
- [ ] dériver le solde par agrégation ; ne jamais écrire un solde de vérité ;
- [ ] implémenter les commandes manuelles et les liens Expense/PaymentRecord
  validés ;
- [ ] garantir rollback état + audit + Outbox.

### 4. Concurrency and corrections

- [ ] verrouiller les comptes avant les sorties et calculs de solde ;
- [ ] ordonner les verrous des transferts ;
- [ ] refuser le solde insuffisant et les comptes inactifs ;
- [ ] rendre les corrections compensatoires, motivées et idempotentes ;
- [ ] tester deux sorties concurrentes, transfert concurrent et rejeu.

### 5. Migration and cross-phase proof

- [ ] prouver base vide et upgrade depuis la Task 4 ;
- [ ] prouver contraintes PostgreSQL, isolation, OpenAPI, contrats et E2E ;
- [ ] exécuter la non-régression complète Phases 0–7 ;
- [ ] enregistrer les sorties et URL CI sans inférer un succès absent.

### 6. Closure

- [ ] mettre à jour `Docs/78_PHASE_7_STATUS.md` et l'issue #95 après CI
  post-merge verte ;
- [ ] supprimer la branche fusionnée ;
- [ ] ne pas clôturer la Phase 7 : la clôture finale reste une étape distincte.

