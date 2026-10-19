# Phase 9.6 — Billing lifecycle evidence

**Statut : en exécution — tranche 9.6.3/9.6.4, non clôturée.**

Ce document décrit les preuves attendues et les mécanismes livrés par la tranche de rapprochement et de cycle de vie. Il ne constitue pas une déclaration de mise en production commerciale.

## Mécanismes livrés

- calcul UTC déterministe des anniversaires mensuels et annuels, avec correction des dates 28/29/30/31 et des années bissextiles ;
- clé d'idempotence déterministe par contrat et période pour les renouvellements ;
- émission transactionnelle d'une facture ouverte et, en environnement de test uniquement, d'une tentative `TEST` ;
- validation du paiement renouvelé par webhook signé avant réactivation et avancement de la période ;
- rapprochement des événements `REFUNDED` et `CHARGEBACK` vers `BillingPayment`, `BillingRefund`, la facture et le contrat ;
- dunning V1 : `PAST_DUE` pendant sept jours, puis `SUSPENDED` et facture `UNCOLLECTIBLE`, sans suppression historique ;
- changements programmés idempotents pour plan, période, extension et résiliation à l'échéance ;
- commandes plateforme métadonnées pour consulter les contrats/factures et exécuter les jobs de renouvellement/dunning ;
- migrations additivement vérifiables depuis la baseline Phase 9.5 et depuis une base vide.

## Contrôles de sécurité et d'intégrité

- les mutations tenant passent par membership actif et `billing:write` ; les lectures restent tenant-scoped ;
- les commandes plateforme passent par `PLATFORM_ADMIN_USER_IDS` et n'exposent que des métadonnées ;
- le fournisseur `TEST` est refusé hors `NODE_ENV=test` ; aucun PAN/CVV ni secret fournisseur n'est persisté ;
- les montants et devises sont relus depuis les lignes/factures serveurs ; les webhooks vérifient signature, référence, montant et devise ;
- les factures et paiements sont protégés par les contraintes/triggers de la migration Phase 9.6 ; l'Outbox et l'audit sont écrits dans la même transaction.

## Preuves locales de cette tranche

- `npm run prisma:phase96:migration-proof` : base vide (49 migrations) et upgrade Phase 9.5 (46 + 3), structures Billing immuables et seed idempotent ;
- tests unitaires des dates de période ;
- tests PostgreSQL de renouvellement, paiement vérifié, rejeu et dunning ;
- test HTTP E2E du parcours devis → checkout → paiement signé → abonnement → facture → remboursement/chargeback.

## Limitation de mise en service

Le seul fournisseur actif dans le dépôt est le canal `TEST`, explicitement limité à l'environnement de test. Tant qu'un fournisseur live n'est pas configuré, vérifié, observable et rapproché, le lancement automatique de l'offre payante reste bloqué conformément à Docs/89, Docs/91 et Docs/92. La phase ne pourra être clôturée qu'après les contrôles CI PR/post-fusion et la décision documentée sur ce gate.
