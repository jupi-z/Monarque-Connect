# Phase 11 — Control Plane multi-produits Monarque Connect × ZAMUREK

**PLANNED — extension de capacités déjà partiellement présentes en FairScale 9.5/9.6.** Ne pas reconstruire Pricing/Billing/Subscriptions existants.

## Travaux
1. Catalogue produits `MONARQUE_CONNECT` et `ZAMUREK`, versions de plans et associations entitlements isolées ; modèle des organisations pouvant posséder zéro, une ou deux souscriptions produit. Ne pas confondre commerce tenant et factures SaaS.
2. SKU commercial `ZAMUREK_BASIC` (prix de travail 7 USD/mois/organisation). Clarifier quotas/établissements, frais de support, coûts agents, cumul avec FairScale, tenant suspensions et limites de coûts avant commercialisation. **Une souscription ZAMUREK ne débloque pas les modules Business/Enterprise**.
3. Provisioning et onboarding multi-canaux : une Organization existante peut activer ZAMUREK, utiliser mêmes Sales/Cash/Invoice tout en conservant plan Monarque Connect ; migration de droits additive non disruptive.
4. Administration plateforme par client **Windows installé + VPN/MFA** pour ZAMUREK ; support-safe views, audits, limites, revue des consentements venue et permissions agent.
5. Entitlements consommables en temps réel par middleware/command handlers, scopes établissement, policies par canal ; anti-contournement par clients personnalisés.
6. Éviter double facturation si l'organisation choisit un bundle ; migration/upgrade/downgrade à date et remboursement/exports audités.
7. Externalité 9.6 : paiement provider/reconciliation/conformité toujours gate commercial séparé.

## Recette
ZAMUREK-only, MC-only, double produit, changement de plan, suspension d'une souscription sans destruction de l'autre produit, staff multi-établissement, quota et override, refus d'accès au module non entitled, taxes/devise SaaS versionnés. Tests des anciennes souscriptions/renouvellements FairScale inchangés. CI + preuves.
