# 72 — Phase 5 Sales — Statut

## État courant

La Phase 5 — Sales est **ouverte en cadrage et préparation d'exécution** sur
la baseline `main@7ff4c54f18a49460585bba2e145e73f590cdfe16`.

Le suivi est porté par l'[issue #63](https://github.com/jupi-z/Monarque-Connect/issues/63).
La spécification normative est
[`71_PHASE5_SALES_EXECUTION_SPEC.md`](71_PHASE5_SALES_EXECUTION_SPEC.md) et
le plan séquencé est
[`2026-10-13-phase-5-sales-plan.md`](superpowers/plans/2026-10-13-phase-5-sales-plan.md).

La phase n'a pas encore livré d'endpoint métier ni de migration. Aucun statut
de clôture ne doit être annoncé avant la preuve de tous les gates.

## Périmètre

- [ ] Quotes ;
- [ ] Sales Orders ;
- [ ] Invoices ;
- [ ] PaymentRecords ;
- [ ] conversions idempotentes Quote → Order → Invoice ;
- [ ] paiements partiels et corrections traçables ;
- [ ] OpenAPI, événements, audit et idempotence ;
- [ ] migrations et preuves PostgreSQL.

## Découpage prévu

1. contrats, permissions, entitlements et modèle ;
2. Quotes ;
3. Sales Orders ;
4. Invoices ;
5. PaymentRecords ;
6. preuves cross-phase et clôture.

Chaque tranche sera livrée par branche dédiée, PR, CI verte, fusion contrôlée
et suppression de branche. La Phase 4 ne sera pas rouverte et la Phase 6 ne
sera pas ouverte par anticipation.

## Contraintes de sécurité et d'intégrité

- chaîne canonique d'autorisation obligatoire ;
- données strictement tenant-scoped et establishment-scoped ;
- snapshots immuables après émission ;
- calculs monétaires côté serveur ;
- aucun paiement externe exécuté ;
- audit et Outbox dans la transaction métier ;
- aucune déduction réglementaire implicite.

## Gates de clôture

- [ ] contrats OpenAPI détaillés et validés ;
- [ ] modèles et transitions PostgreSQL livrés ;
- [ ] permissions, entitlement `SALES`, activation et scopes prouvés ;
- [ ] calculs monétaires, taxes explicites et arrondis testés ;
- [ ] idempotence, concurrence et numérotation testées ;
- [ ] audit + Outbox atomiques ;
- [ ] isolation tenant/établissement et refus négatifs ;
- [ ] migrations base vide et upgrade depuis Phase 4 ;
- [ ] suite complète, E2E, build et smoke HTTP ;
- [ ] CI PR et post-merge `main` vertes ;
- [ ] preuve documentaire, issue #63 et roadmap synchronisées ;
- [ ] branche de livraison supprimée.

## Décisions hors périmètre

La phase ne valide pas la conformité fiscale ou de paiement d'une juridiction,
la facture électronique, les remboursements, les avoirs réglementaires, le
multi-devise ou la comptabilité générale. Ces sujets restent soumis à une
décision métier/juridique séparée.
