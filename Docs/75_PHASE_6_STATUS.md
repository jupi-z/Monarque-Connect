# 75 — Phase 6 Purchases — Statut

## État final

La Phase 6 — Purchases est **clôturée techniquement et normativement à 100 %**.
La baseline d'ouverture était `main@623fa9e79947e4608f7d2c66d841d053b22684e2`.
La livraison fonctionnelle et les preuves d'exécution sont intégrées sur
`main@8902b56ac8ffc265a1bab085bb6c5d1ffd86e860`; la présente PR assure la
synchronisation documentaire finale.

Le suivi est porté par l'[issue #75](https://github.com/jupi-z/Monarque-Connect/issues/75).
La spécification normative est
[`74_PHASE6_PURCHASES_EXECUTION_SPEC.md`](74_PHASE6_PURCHASES_EXECUTION_SPEC.md)
et le plan d'exécution est
[`2026-10-13-phase-6-purchases-plan.md`](superpowers/plans/2026-10-13-phase-6-purchases-plan.md).

Le périmètre est `SupplierRFQ → PurchaseOrder → GoodsReceipt`. La frontière
avec Inventory est stricte : Phase 6 constate les réceptions et publie des
événements ; Phase 7 possédera les mouvements, réservations, valorisations et
projections de stock.

## Périmètre livré

- [x] SupplierRFQ mono-établissement et lignes snapshotées ;
- [x] RFQ multi-fournisseurs local/Network avec isolation des destinataires ;
- [x] PurchaseOrder direct ou issu d'une attribution RFQ ;
- [x] transitions et numérotation transactionnelles ;
- [x] GoodsReceipt totale ou partielle ;
- [x] cumul, dépassement refusé et corrections compensatoires ;
- [x] permissions, entitlement `PURCHASES`, activation et scopes ;
- [x] contrats OpenAPI détaillés et validés ;
- [x] événements versionnés, audit et Outbox atomiques ;
- [x] idempotence, concurrence et rollback ;
- [x] migrations base vide et upgrade depuis Phase 5 ;
- [x] tests PostgreSQL, E2E et non-régression Phases 0 à 5.

## Séquençage approuvé

1. valider la spécification, la matrice d'autorisation et le contrat OpenAPI ;
2. ajouter les modèles et migrations sans aucun moteur de stock ;
3. livrer SupplierRFQ et ses destinataires isolés ;
4. livrer PurchaseOrder et l'attribution partielle RFQ ;
5. livrer GoodsReceipt, cumul, concurrence et corrections ;
6. ajouter preuves cross-phase, E2E, migration et clôture.

Chaque tranche devra suivre branche dédiée → PR → CI → fusion contrôlée →
suppression de branche. La Phase 7 ne sera pas ouverte par anticipation et
aucune phase précédente ne sera refondue silencieusement.

## Gates de sortie

- [x] modèle et contraintes PostgreSQL ;
- [x] RFQ multi-fournisseurs et confidentialité inter-fournisseurs ;
- [x] PurchaseOrder et snapshots ;
- [x] GoodsReceipt partielle, cumulative, concurrente et corrections ;
- [x] frontière Phase 6 / Inventory Phase 7 prouvée ;
- [x] autorisation, entitlement et scopes ;
- [x] OpenAPI et contrats ;
- [x] audit + Outbox atomiques ;
- [x] idempotence, numérotation et concurrence ;
- [x] migrations base vide et upgrade depuis Phase 5 ;
- [x] tests PostgreSQL, E2E, build et smoke HTTP ;
- [x] CI PR et post-merge `main` vertes ;
- [x] issue #75, roadmap et tracker synchronisés ;
- [x] branches de livraison supprimées.

## Preuves de clôture

- Spécification normative : `Docs/74_PHASE6_PURCHASES_EXECUTION_SPEC.md`.
- Preuve migration/E2E : `Docs/76_PHASE_6_CLOSURE_EVIDENCE.md`.
- Tranches fonctionnelles : PR #77, #78, #79, #80 et #81.
- Preuves cross-phase : PR #82.
- CI PR Task 5 : [Backend CI #227](https://github.com/jupi-z/Monarque-Connect/actions/runs/38457709337).
- CI post-merge Task 5 : [Backend CI #228](https://github.com/jupi-z/Monarque-Connect/actions/runs/38458167296).
- CI PR Task 6 : [Backend CI #229](https://github.com/jupi-z/Monarque-Connect/actions/runs/38461090820).
- CI post-merge de clôture technique : [Backend CI #230](https://github.com/jupi-z/Monarque-Connect/actions/runs/38461554292).

La Phase 7 — Operations reste volontairement fermée tant qu'une nouvelle
spécification et son plan d'exécution n'ont pas été approuvés.

## Décisions hors périmètre

La phase ne valide aucune obligation fiscale, comptable ou réglementaire
nationale, ne traite pas les factures/paiements fournisseurs et ne crée pas de
moteur de stock. Les mouvements Inventory, réservations et valorisations sont
réservés à la Phase 7.
