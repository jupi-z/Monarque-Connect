# ADR-038 — FairScale V1 : pricing/capacity séparés des entitlements

**Statut : ACCEPTED (décision de produit), Phase 9.5 implémentée ; Phase 9.6 restante**
**Date : 2026-10-19**  
**Norme : Docs/89_FAIRSCALE_V1_NORMATIVE_SPEC.md**

## Contexte
La Phase 2 livre Plan/PlanVersion, Subscription, entitlements et quotas ; les seeds EUR/MONTHLY, les plafonds MAX_USERS et l'absence de paiement SaaS ne réalisent pas FairScale. Phase 9 est clôturée.

## Décision
1. Insérer **Phases 9.5 et 9.6**, sans rouvrir 2 ou 9.
2. Plan fonctionnel indépendant du business type et de la taille ; capacité incluse et extensible ; services optionnels et tarifs en USD, versionnés et auditables.
3. CONNECT gratuit, OPERATIONS 15, BUSINESS 45, ENTERPRISE 180 USD/mois. WELCOME_MONTHLY15 : trois premières mensualités payantes admissibles, une seule fois par entreprise. ANNUAL20 : 20 % à **chaque** échéance annuelle, sans cumul et sur le forfait de base exclusivement.
4. Pas de prix/plafond commercial par collaborateur interne sur forfaits payants ; CONNECT peut garder cinq comptes gratuits. Conserver permissions et limites de sécurité.
5. Établissements de référence : 1/1/3/10 ; extension payante par site actif proposée à 10 USD/mois ou 120 USD/an, valeur dans catalogue versionné sous consentement ; ENTERPRISE peut contractualiser ses capacités.
6. Platform Billing est distinct des factures SALES des tenants ; aucune activation avant paiement confirmé ou exemption plateforme justifiée ; préservation de l'export tenant non premium.
7. Migrations additives, OpenAPI d'abord, sécurité/isolation, Outbox, CI et contrôles de non-régression obligatoires.

## Alternatives rejetées
Tarification à l'employé, taille/secteur imposant le plan, sauts tarifaires brusques à seuil d'effectif, promotions réinitialisables par compte, modification destructive du plan v1, mélange SALES et facturation SaaS.

## Conséquences
Il faut ajouter prix/cycles/snapshots/promotions/capacités, Billing Core et administrateur Billing, un adaptateur de paiement vérifiable, ainsi que des tests. Phase 11 pourra ensuite compléter les fonctionnalités plateforme transverses. Pas d'inférence de conformité légale/fiscale ou de SLA non contractualisé.
