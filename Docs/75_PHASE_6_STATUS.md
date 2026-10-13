# 75 — Phase 6 Purchases — Statut

## État courant

La Phase 6 — Purchases est **ouverte officiellement en cadrage normatif** le
13/10/2026 sur `main@623fa9e79947e4608f7d2c66d841d053b22684e2`. Aucun modèle,
migration, contrôleur ou service métier Phase 6 n'est encore déclaré livré.

Le suivi est porté par l'[issue #75](https://github.com/jupi-z/Monarque-Connect/issues/75).
La spécification normative est
[`74_PHASE6_PURCHASES_EXECUTION_SPEC.md`](74_PHASE6_PURCHASES_EXECUTION_SPEC.md)
et le plan d'exécution est
[`2026-10-13-phase-6-purchases-plan.md`](superpowers/plans/2026-10-13-phase-6-purchases-plan.md).

Le périmètre est `SupplierRFQ → PurchaseOrder → GoodsReceipt`. La frontière
avec Inventory est stricte : Phase 6 constate les réceptions et publie des
événements ; Phase 7 possédera les mouvements, réservations, valorisations et
projections de stock.

## Périmètre et état

- [ ] SupplierRFQ mono-établissement et lignes snapshotées ;
- [ ] RFQ multi-fournisseurs local/Network avec isolation des destinataires ;
- [ ] PurchaseOrder direct ou issu d'une attribution RFQ ;
- [ ] transitions et numérotation transactionnelles ;
- [ ] GoodsReceipt totale ou partielle ;
- [ ] cumul, dépassement refusé et corrections compensatoires ;
- [ ] permissions, entitlement `PURCHASES`, activation et scopes ;
- [ ] contrats OpenAPI détaillés et validés ;
- [ ] événements versionnés, audit et Outbox atomiques ;
- [ ] idempotence, concurrence et rollback ;
- [ ] migrations base vide et upgrade depuis Phase 5 ;
- [ ] tests PostgreSQL, E2E et non-régression Phases 0 à 5.

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

- [ ] modèle et contraintes PostgreSQL ;
- [ ] RFQ multi-fournisseurs et confidentialité inter-fournisseurs ;
- [ ] PurchaseOrder et snapshots ;
- [ ] GoodsReceipt partielle, cumulative, concurrente et corrections ;
- [ ] frontière Phase 6 / Inventory Phase 7 prouvée ;
- [ ] authorization, entitlement et scopes ;
- [ ] OpenAPI et contrats ;
- [ ] audit + Outbox atomiques ;
- [ ] idempotence, numérotation et concurrence ;
- [ ] migrations base vide et upgrade depuis Phase 5 ;
- [ ] tests PostgreSQL, E2E, build et smoke HTTP ;
- [ ] CI PR et post-merge `main` vertes ;
- [ ] issue #75, roadmap et tracker synchronisés ;
- [ ] branches de livraison supprimées.

## Décisions hors périmètre

La phase ne valide aucune obligation fiscale, comptable ou réglementaire
nationale, ne traite pas les factures/paiements fournisseurs et ne crée pas de
moteur de stock. Les mouvements Inventory, réservations et valorisations sont
réservés à la Phase 7.
