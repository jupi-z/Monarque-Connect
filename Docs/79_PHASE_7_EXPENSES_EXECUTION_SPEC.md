# 79 — Phase 7 Task 4 — Spécification d’exécution Expenses

## Autorité et statut

Ce document précise la tranche Expenses de la Phase 7 — Operations. Il est
normatif pour le modèle, l’API, les événements, l’autorisation et les preuves
de migration de cette tranche.

La tranche part de `main@e001596c88fd31c9fa72d7c91547f140242c349a` et est suivie
par l’[issue #92](https://github.com/jupi-z/Monarque-Connect/issues/92), en
complément de l’[issue Phase 7 #84](https://github.com/jupi-z/Monarque-Connect/issues/84).

Expenses ne constitue ni un moteur comptable, ni un moteur fiscal, ni une
qualification réglementaire. Aucune règle propre à une juridiction n’est
introduite par cette tranche.

## Décisions de frontière

### Références externes

`BusinessParty` est le seul référentiel transverse actuellement propriétaire
d’un modèle livré et tenant-qualified. `partyId` peut donc être validé par une
clé étrangère composite et par une vérification d’appartenance au tenant.

Les domaines `Projects` et `Documents` ne possèdent pas encore de modèle
autoritaire dans le dépôt. Expenses v1 ne stocke donc pas de `projectId` ni de
`documentId` opaques et ne prétend pas valider leur tenant. Leurs liens seront
ajoutés dans une tranche propriétaire de ces domaines, avec leurs contraintes
composites et leurs contrats dédiés.

De la même manière, Expenses v1 ne crée ni ne référence de `CashMovement` :
`CashAccounts`/`CashMovements` appartient à la Task 5. La transition `RECORDED`
est complète sans caisse. La Task 5 pourra introduire un lien idempotent vers
une écriture Cash sans réécrire les faits Expense.

Cette restriction est intentionnelle : aucun identifiant non vérifiable ne doit
devenir une pseudo-référence inter-domaine.

## Modèle métier

Une `Expense` est rattachée à exactement une organisation et un établissement
actif de cette organisation. Elle contient :

- `id` UUID immuable ;
- `organizationId`, `establishmentId` ;
- `status` : `DRAFT`, `RECORDED` ou `VOID` ;
- `description` non vide, longueur maximale 500 ;
- `category` non vide, longueur maximale 80 ;
- `amount` strictement positif, PostgreSQL `numeric(19,4)` ;
- `currency` canonique en trois lettres majuscules ;
- `expenseDate` au format date sans fuseau ;
- `partyId` optionnel, qualifié par `organizationId` ;
- `voidReason` nullable, uniquement renseigné à l’annulation ;
- auteur et timestamps.

Les sommes ne sont pas recalculées ni arrondies par une logique fiscale : le
montant est validé côté serveur et conservé à quatre décimales.

## Transitions et immutabilité

Les transitions autorisées sont strictement :

```text
DRAFT → RECORDED → VOID
```

- `DRAFT` est le seul état éditable ; le montant et la devise peuvent être
  définis à la création mais ne sont jamais éditables après création ;
- `RECORDED` est immuable ; une erreur de montant exige une nouvelle décision
  métier future, pas une réécriture ;
- `VOID` est terminal et exige un motif non vide ;
- toute transition concurrente relit l’état et renvoie le résultat déjà produit
  ou `409` selon la cible demandée ;
- aucune suppression physique n’est exposée.

## Autorisation et isolation

Chaque lecture et mutation suit la chaîne existante :

```text
tenant actif → membership actif → entitlement EXPENSES autorisé
→ module activé → permission → scope établissement
```

Les routes de lecture utilisent `expenses:read`. La création, l’édition, la
mise en enregistrement et l’annulation utilisent `expenses:write`.

Un membre `SELECTED_ESTABLISHMENTS` ne voit et ne modifie que les dépenses de
ses établissements autorisés. Toutes les requêtes filtrent explicitement
`organizationId`; aucune ressource d’un autre tenant ne peut être résolue par
un identifiant fourni au client.

## Idempotence et concurrence

Toute mutation exige `Idempotency-Key`. La clé est unique dans le tenant et
porte une empreinte canonique de la commande, son opération et la ressource
ciblée.

- même clé + même empreinte : retour de la ressource existante ;
- même clé + empreinte différente : `409 Conflict` ;
- une clé utilisée pour une autre opération ou une autre ressource : `409` ;
- les transitions utilisent une mise à jour conditionnelle sur l’état courant
  afin qu’une seule commande concurrente produise l’événement métier ;
- l’audit, la mutation, le registre d’idempotence et l’Outbox sont engagés ou
  annulés ensemble.

## Audit et événements

Les actions produisent les audits canoniques :

- `EXPENSE_CREATED` ;
- `EXPENSE_UPDATED` ;
- `EXPENSE_RECORDED` ;
- `EXPENSE_VOIDED`.

Les événements versionnés sont :

- `expenses.created.v1` ;
- `expenses.updated.v1` ;
- `expenses.recorded.v1` ;
- `expenses.voided.v1`.

Chaque enveloppe contient le tenant, l’établissement, l’acteur, l’aggregate,
la corrélation et le request ID selon le contrat Event Fabric. Le payload ne
contient que les faits nécessaires : identifiants, état, montant, devise,
catégorie et motif d’annulation éventuel ; il ne contient aucun dump ORM ni
donnée privée inutile.

## Contrat HTTP v1

Le contrat autoritaire est `openapi/openapi.yaml` sous `/api/v1` :

- `GET/POST /organizations/{organizationId}/expenses` ;
- `GET/PATCH /organizations/{organizationId}/expenses/{expenseId}` ;
- `POST /organizations/{organizationId}/expenses/{expenseId}/record` ;
- `POST /organizations/{organizationId}/expenses/{expenseId}/void`.

Les réponses exposent les montants comme chaînes décimales. Les erreurs
`400/401/403/404/409` utilisent les réponses Problem Details existantes. Les
champs Project, Document et Cash ne sont pas acceptés en v1 tant que leurs
modèles propriétaires n’existent pas.

## Migration et preuves

La migration est additive depuis la baseline Phase 6/Task 3 et doit prouver :

1. clé étrangère composite Expense → Organization/Establishment/BusinessParty ;
2. précision et positivité de `amount` ;
3. devise et dates bornées par le contrat ;
4. unicité de l’idempotence par tenant/opération/acteur ;
5. aucune suppression ou modification des migrations Phases 0 à 6 ;
6. seed sans données opérationnelles fictives.

La suite obligatoire couvre le cycle complet, les états illégaux, l’immuabilité
de `RECORDED`, le motif de `VOID`, l’isolation tenant et établissement, les
références Party inter-tenant, les retries idempotents, la concurrence et le
rollback état + audit + Outbox.

## Non-objectifs

- création automatique d’un CashMovement ;
- calcul fiscal ou comptable ;
- rapprochement bancaire ;
- correction en place d’une dépense enregistrée ;
- modèle Project ou Document anticipé ;
- réouverture ou modification silencieuse des Phases 0 à 6.
