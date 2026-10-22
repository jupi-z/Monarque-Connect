# Phase 11 — Control Plane multi-produits Monarque Connect × ZAMUREK

**PLANNED — extension de capacités déjà partiellement présentes en FairScale 9.5/9.6.** Ne pas reconstruire Pricing/Billing/Subscriptions existants. **Norme de migration et de compatibilité :** [Docs/114](114_PHASE_10A5_BOUNDARY_INVARIANTS.md) B-02/B-06 ; ne pas modifier le sens des API et resolver legacy.

## Travaux
1. Catalogue produits `MONARQUE_CONNECT` et `ZAMUREK`, versions de plans/entitlements isolées ; **abonnement effectif unique par (organizationId, productCode)** avec chevauchement entre produits autorisé. Backfill existant = MONARQUE_CONNECT, anciennes PK, factures et `resolveEffective(organizationId)` conservées. Contraintes PostgreSQL et tests d'upgrade depuis 9.6/10A. Ne pas confondre commerce tenant et factures SaaS.
2. SKU commercial `ZAMUREK_BASIC` (prix de travail 7 USD/mois/organisation). Clarifier quotas/établissements, frais de support, coûts agents, cumul avec FairScale, tenant suspensions et limites de coûts avant commercialisation. **Une souscription ZAMUREK ne débloque pas les modules Business/Enterprise**.
3. Provisioning et onboarding multi-canaux : une Organization existante peut activer ZAMUREK, utiliser les **commands POS limités** de Sales/Cash/Invoice tout en conservant le plan MC ; pas d'accès générique `cash:write` ou `sales:invoices:write` par simple souscription, suspension/downgrade produit isolés, suspension organization globale réservée à la sécurité.
4. Administration plateforme par client **Windows installé + VPN/MFA** pour ZAMUREK ; support-safe views, audits, limites, revue des consentements venue et permissions agent.
5. Entitlements consommables en temps réel par middleware/command handlers, scopes établissement, policies par canal ; anti-contournement par clients personnalisés.
6. Éviter double facturation si l'organisation choisit un bundle ; migration/upgrade/downgrade à date et remboursement/exports audités.
7. Externalité 9.6 : paiement provider/reconciliation/conformité toujours gate commercial séparé.

## Recette

**Gates de développement** : essais MC-only, ZAMUREK-only, double produit et anciennes API/client, règle DENY prioritaire, quotas isolés et rétrocompatibilité billing FairScale. Prix BASIC 7 USD non activable avant décision commerciale chiffrée. Le frontend et l'API ne sont jamais source d'autorité sur droits ou prix.

ZAMUREK-only, MC-only, double produit, changement de plan, suspension d'une souscription sans destruction de l'autre produit, staff multi-établissement, quota et override, refus d'accès au module non entitled, taxes/devise SaaS versionnés. Tests des anciennes souscriptions/renouvellements FairScale inchangés. CI + preuves.
