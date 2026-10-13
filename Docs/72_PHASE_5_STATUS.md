# 72 — Phase 5 Sales — Statut

## État courant

La Phase 5 — Sales est **clôturée techniquement à 100 % le 13/10/2026**. Sa
baseline de cadrage reste `main@7ff4c54f18a49460585bba2e145e73f590cdfe16`;
les livraisons ont été intégrées progressivement sur `main` par PR dédiées.

Le suivi est porté par l'[issue #63](https://github.com/jupi-z/Monarque-Connect/issues/63).
La spécification normative est
[`71_PHASE5_SALES_EXECUTION_SPEC.md`](71_PHASE5_SALES_EXECUTION_SPEC.md) et
le plan séquencé est
[`2026-10-13-phase-5-sales-plan.md`](superpowers/plans/2026-10-13-phase-5-sales-plan.md).

Le socle contractuel, le modèle PostgreSQL Sales, les Quotes, Sales Orders,
Invoices et PaymentRecords sont livrés. Les PR #67 à #73 ont été validées par
CI puis squash-mergées. La PR [#73](https://github.com/jupi-z/Monarque-Connect/pull/73)
a intégré les preuves finales dans `main` sous
`921d329a7c19e64b5f054a49c1d9c6fee7b8d2ba`; sa CI PR
[Backend CI #210](https://github.com/jupi-z/Monarque-Connect/actions/runs/38409251058)
et sa CI post-merge `push` sur `main`,
[Backend CI #211](https://github.com/jupi-z/Monarque-Connect/actions/runs/38409757868),
sont conclues avec succès.

## Périmètre

- [x] Quotes — création, lecture, édition DRAFT et transitions livrées ;
- [x] Sales Orders — création directe, lecture, édition DRAFT, confirmation,
  annulation et conversion idempotente depuis un Quote ACCEPTED ;
- [x] Invoices ;
- [x] PaymentRecords ;
- [x] conversions idempotentes Quote → Order → Invoice ;
- [x] paiements partiels et corrections traçables ;
- [x] OpenAPI, événements, audit et idempotence ;
- [x] migrations et preuves PostgreSQL.

## Découpage prévu

1. contrats, permissions, entitlements et modèle ;
2. Quotes ;
3. Sales Orders ;
4. Invoices ;
5. PaymentRecords ;
6. preuves cross-phase et clôture — réalisées par la PR #73.

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

- [x] contrats OpenAPI détaillés et validés ;
- [x] modèles et transitions PostgreSQL livrés ;
- [x] permissions, entitlement `SALES`, activation et scopes prouvés ;
- [x] calculs monétaires, taxes explicites et arrondis testés ;
- [x] idempotence, concurrence et numérotation testées ;
- [x] audit + Outbox atomiques ;
- [x] isolation tenant/établissement et refus négatifs ;
- [x] migrations base vide et upgrade depuis Phase 4 ;
- [x] suite complète, E2E, build et smoke HTTP ;
- [x] CI PR et post-merge `main` vertes ;
- [x] preuve documentaire, issue #63 et roadmap synchronisées ;
- [x] branches de livraison supprimées.

La décision de clôture ne constitue pas une déclaration de préparation à la
production publique : les réserves réglementaires, fiscales, de paiement et
de hardening restent hors de cette phase.

## Décisions hors périmètre

La phase ne valide pas la conformité fiscale ou de paiement d'une juridiction,
la facture électronique, les remboursements, les avoirs réglementaires, le
multi-devise ou la comptabilité générale. Ces sujets restent soumis à une
décision métier/juridique séparée.
