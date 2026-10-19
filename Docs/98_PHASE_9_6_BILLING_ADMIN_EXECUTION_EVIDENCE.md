# 98 — Phase 9.6 : preuve d'exécution Billing Control Plane

**Statut au 19/10/2026 : tranche 9.6.5 fusionnée et vérifiée ; Phase 9.6 globale non clôturée tant que les gates live/conformité restent ouverts.**

Ce document trace la tranche 9.6.5 sans modifier les décisions FairScale V1 ni prétendre à une mise en production payante.

## Surface livrée sur la branche

- lecture d'une facture Billing par un tenant, avec vérification simultanée de `organizationId` et de la permission `billing:read` ; un UUID d'une autre organisation retourne `404` ;
- `POST /api/v1/platform/billing/prices`, réservé à `PLATFORM_ADMIN` ;
- publication additive d'une `PriceVersion` USD et d'un composant d'extension établissement ;
- version suivante calculée sous verrou PostgreSQL, ancienne version conservée avec `retiredAt`, aucune facture ou quote historique réécrite ;
- clé `Idempotency-Key` persistée et rejeu divergent refusé ;
- audit `BILLING_PRICE_VERSION_PUBLISHED` et Outbox `billing.price.published`, sans données de carte ni secret fournisseur.

## Limites explicites

La commande d'administration publie seulement des métadonnées de catalogue. Elle ne fournit ni fournisseur de paiement live, ni mandat de prélèvement, ni validation fiscale ou réglementaire. Le gate FS-033 reste donc bloquant pour un lancement commercial automatique en staging/production, conformément à Docs/89 et Docs/91.

## Preuves attendues avant fermeture

## Preuves GitHub observées

- PR corrective : [#135](https://github.com/jupi-z/Monarque-Connect/pull/135), fusion squash dans `main` ;
- commit de fusion : `6309aded22c1fda878aa73941be29e591c22e334` ;
- CI PR : [Backend CI #135 — run 39270635852](https://github.com/jupi-z/Monarque-Connect/actions/runs/39270635852), conclusion `success` ;
- CI post-fusion : [Backend CI main — run 39271364601](https://github.com/jupi-z/Monarque-Connect/actions/runs/39271364601), conclusion `success` ;
- branche `monarque/phase9-6-billing-admin` supprimée après fusion ; `origin` ne conserve que `main`.

Les contrôles CI ont validé les migrations base vide et upgrade 9.5, les contrats OpenAPI, les tests unitaires/intégration, les E2E HTTP, le build et le smoke HTTP. La preuve locale complémentaire a validé 50 migrations base vide, `46 + 4` depuis la baseline 9.5, le seed idempotent et les structures Billing immuables.

## Décision de gate

La livraison technique 9.6.1–9.6.5 est GO. Le lancement commercial automatique reste NO-GO tant qu'aucun provider live vérifié, mandat de paiement opérationnel, rapprochement de production, observabilité, sauvegarde et revue conformité des factures Monarque Group ne sont prouvés. Le provider `TEST` demeure réservé à `NODE_ENV=test` et ne constitue pas une preuve de mise en production.
