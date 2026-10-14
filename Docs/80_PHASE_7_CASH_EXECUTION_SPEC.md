# 80 — Phase 7 Task 5 — CashAccounts et CashMovements

## 1. Décision et baseline

Cette spécification fige le périmètre de la Task 5 avant toute migration ou
implémentation métier. Elle est préparée sur `main@51878617729d938ec036b25334d119f0c4e68a5a`
le 14 octobre 2026 et suivie par l'issue
[#95](https://github.com/jupi-z/Monarque-Connect/issues/95).

La Task 5 livre un ledger de caisse opérationnel. Elle ne livre ni une
comptabilité générale, ni un rapprochement bancaire, ni une conformité fiscale
ou réglementaire juridictionnelle.

## 2. Frontières d'architecture

- `CashAccount` est propriétaire de l'identité, de la devise et de l'état du
  compte ; il ne stocke pas de solde mutable de vérité.
- `CashMovement` est l'écriture append-only autoritative. Le solde est dérivé
  par agrégation des écritures valides.
- `Expense` reste propriétaire du fait de dépense. Task 5 peut créer un lien
  Cash explicite, idempotent et audité ; aucune écriture Cash n'est créée
  automatiquement par la transition `Expense → RECORDED`.
- `PaymentRecord` reste propriétaire du fait de paiement de Sales. Cash peut
  référencer un PaymentRecord validé, sans le réécrire.
- Les corrections sont de nouvelles écritures compensatoires liées à la
  source ; aucune édition ou suppression historique n'est autorisée.
- Les transferts same-currency produisent deux mouvements liés dans une seule
  transaction. Une conversion de devise est hors périmètre.

Hors périmètre : rapprochement bancaire, processeur de paiement, conversion de
devise, frais implicites, valorisation, grand livre, TVA, retenues, facturation
électronique et toute obligation réglementaire nationale non spécifiée.

## 3. Modèle métier normatif

### CashAccount

Champs minimaux : `id`, `organizationId`, `establishmentId`, `code`, `name`,
`currency`, `status`, auteur et timestamps.

- `status` vaut `ACTIVE` ou `INACTIVE` ;
- `code` est unique dans l'organisation, sans collision tenant ;
- `currency` est une chaîne ISO alpha-3 normalisée côté serveur ;
- une création exige un établissement appartenant à l'organisation ;
- un compte inactif ne peut recevoir aucune nouvelle écriture et ne peut pas
  être utilisé comme source ou destination de transfert ;
- l'inactivation ne supprime ni ne réécrit les mouvements existants ;
- aucune suppression physique de compte n'est exposée en v1.

### CashMovement

Champs minimaux : `id`, organisation, établissement, `accountId`, `direction`
(`IN|OUT`), `amount numeric(19,4)`, devise dérivée du compte, `occurredAt`,
`reason`, auteur, type de source, identifiant de source, lien de correction ou
de transfert, clé d'idempotence et timestamps.

Le montant est strictement positif. La devise envoyée par le client, si elle
est présente dans le contrat, doit correspondre à celle du compte ; le serveur
ne convertit jamais un montant. Le solde exposé est :

`SUM(IN.amount) - SUM(OUT.amount)`.

Les types opérationnels v1 sont `DEPOSIT`, `WITHDRAWAL`, `PAYMENT`, `EXPENSE`,
`TRANSFER_IN`, `TRANSFER_OUT`, `CORRECTION_IN` et `CORRECTION_OUT`. Le type ne
change pas la règle de signe : `direction` reste l'autorité de calcul.

### Références de source

Une source est optionnelle pour un mouvement manuel et qualifiée par tenant.
Lorsqu'elle est fournie, le serveur vérifie :

- `EXPENSE` : l'Expense appartient à la même organisation et au même
  établissement ; un lien effectif est unique pour cette Expense, ce compte et
  cette opération ;
- `PAYMENT_RECORD` : le PaymentRecord appartient au tenant Sales courant et
  son établissement est compatible ; Cash ne modifie jamais le paiement ;
- `TRANSFER` : deux mouvements de la même transaction, devises identiques,
  comptes distincts et établissements compatibles selon la politique retenue ;
- `CORRECTION` : référence à un mouvement existant, motif obligatoire et
  inverse exact du montant/direction de l'écriture corrigée, sauf décision
  explicite d'une correction partielle versionnée.

Une référence inconnue, étrangère au tenant ou incompatible avec le type est
refusée avant toute écriture.

## 4. Transitions et invariants

### Compte

`ACTIVE → INACTIVE` est autorisé par une commande idempotente. Un compte
`INACTIVE` peut être consulté et réactivé par une commande autorisée ; il ne
peut pas être utilisé pour une nouvelle écriture tant qu'il est inactif.

### Mouvement

Un mouvement créé est immédiatement immuable. Une correction ajoute un
mouvement inverse et conserve le lien vers l'original. Une seconde correction
avec la même clé d'idempotence rejoue le résultat ; un payload différent produit
`409 Conflict`.

Par défaut, une sortie ne peut pas rendre le solde du compte négatif. Le
contrat ne crée pas de découvert, de plafond ou d'autorisation financière
implicite. Si une politique de solde négatif devient nécessaire, elle fera
l'objet d'une décision et d'un contrat versionnés.

## 5. Autorisation et isolation

Chaque route suit l'ordre central :
`tenant actif → membership actif → entitlement allowed → module CASH actif →
permission → scope établissement`.

Permissions v1 : `cash:read` et `cash:write`, avec la matrice Operations déjà
figée. Les rôles OWNER/ADMIN/FINANCE peuvent écrire selon le scope ;
OPERATIONS peut écrire selon la matrice existante ; SALES ne reçoit pas de
droit Cash par défaut ; VIEWER est en lecture seule.

Toute lecture et mutation revalide côté serveur l'organisation, l'établissement
et le compte. Les clés étrangères PostgreSQL sont tenant-qualified. Aucun
identifiant fourni par le client ne suffit à traverser un tenant ou un scope
`SELECTED_ESTABLISHMENTS`.

## 6. Contrat API-first réservé

Les routes suivantes doivent être détaillées dans `openapi/openapi.yaml` avant
la migration :

- `GET/POST /organizations/{organizationId}/cash/accounts` ;
- `GET /organizations/{organizationId}/cash/accounts/{accountId}` ;
- `POST /organizations/{organizationId}/cash/accounts/{accountId}/activate` ;
- `POST /organizations/{organizationId}/cash/accounts/{accountId}/deactivate` ;
- `GET /organizations/{organizationId}/cash/accounts/{accountId}/balance` ;
- `GET/POST /organizations/{organizationId}/cash/movements` ;
- `POST /organizations/{organizationId}/cash/movements/{movementId}/correction` ;
- `POST /organizations/{organizationId}/cash/transfers`.

Les montants et soldes sont sérialisés comme chaînes décimales. Les erreurs
utilisent le format Problem Details existant. Les commandes d'écriture portent
une clé d'idempotence obligatoire ; les relectures idempotentes retournent la
représentation persistée sans nouvelle écriture.

## 7. Audit, événements et transaction

Chaque mutation réussie écrit dans une transaction PostgreSQL unique :

1. l'état du compte ou les mouvements append-only ;
2. l'audit avec acteur, tenant, établissement, action et motif ;
3. l'événement Outbox versionné.

Événements réservés : `cash.account.created.v1`,
`cash.account.activated.v1`, `cash.account.deactivated.v1`,
`cash.movement.created.v1`, `cash.movement.corrected.v1` et
`cash.transfer.created.v1`. L'enveloppe suit le contrat Event Fabric existant.

Un échec d'audit ou d'Outbox annule les écritures Cash. Un consumer ou un
rejeu ne peut pas produire une seconde écriture effective grâce aux clés
uniques tenant-qualified et aux receipts d'idempotence.

## 8. Concurrence

- les commandes verrouillent le compte avant de calculer le solde ;
- une sortie concurrente revalide le solde sous verrou ;
- un transfert verrouille source et destination dans l'ordre déterministe de
  leurs identifiants ;
- une correction verrouille l'original avant de vérifier son état et son lien ;
- les transitions d'état utilisent une mise à jour conditionnelle afin qu'une
  course ne publie pas deux événements effectifs ;
- les retries de transaction sont bornés et ne contournent jamais
  l'idempotence.

## 9. Migration et preuves obligatoires

La migration est additive depuis `main@51878617729d938ec036b25334d119f0c4e68a5a`.
Elle doit prouver :

- base vide : comptes, mouvements, contraintes, indexes et enums ;
- upgrade depuis la Phase 7 Task 4 : Expenses conservées et référencables ;
- contraintes tenant-qualified, devise et montant ;
- unicité des sources, corrections, transferts et idempotence ;
- rollback transactionnel d'une mutation, de l'audit et de l'Outbox ;
- deux sorties concurrentes, transfert concurrent et rejeu idempotent ;
- isolation tenant/établissement, permissions, entitlements et compte inactif ;
- E2E HTTP, OpenAPI, contrats et régression complète Phases 0–7.

La Task 5 ne sera déclarée livrée qu'après une CI PR et une CI post-merge
vertes, avec les URL et conclusions enregistrées dans le statut et l'issue
#95.

