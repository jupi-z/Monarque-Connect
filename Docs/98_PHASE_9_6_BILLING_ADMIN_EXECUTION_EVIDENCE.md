# 98 — Phase 9.6 : preuve d'exécution Billing Control Plane

**Statut au 19/10/2026 : branche d'exécution en cours ; aucune clôture de Phase 9.6 annoncée.**

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

La branche doit encore obtenir une CI PR verte, une fusion contrôlée, une CI post-fusion verte, la preuve de migration base vide/upgrade depuis 9.5, les tests PostgreSQL/E2E et la mise à jour finale de Docs/92–93. Les SHA et URL GitHub seront ajoutés uniquement après observation effective.
