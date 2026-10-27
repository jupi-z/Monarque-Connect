# ADR-039 — Monarque Connect, socle commercial partagé ; ZAMUREK, produit vertical

**Statut : ACCEPTÉ PAR LE PROPRIÉTAIRE — 27/10/2026.** Les décisions D-01 à D-10 sont arrêtées pour C0 et les lots concernés. Leur acceptation ne signifie pas que les capacités futures sont implémentées, ni que la Phase 10A.5 est clôturée. C0 est désormais clos après fusion de son cadrage et CI post-fusion verte; C1 est autorisé dans le périmètre séquencé ci-dessous et son suivi probant est tenu dans [Docs/117](117_C1_EXECUTION_STATUS.md). Les capacités non livrées restent soumises à leurs propres gates.

**Arbitrage de sûreté complétant ADR-039 :** [Docs/114 — invariants des frontières](114_PHASE_10A5_BOUNDARY_INVARIANTS.md), décisions B-00→B-09, est **normatif avant migration**. En particulier : authentification future Monarque Auth/OIDC sans perte d'identité métier, souscriptions par produit, permissions POS distinctes, Invoice canonique pour le règlement V1, transactions atomiques, stockage réel et gates commerciaux séparés.

## Décision principale
- **Monarque Connect** reste le **backend transactionnel canonique et propriétaire** : identité métier et rattachement OIDC futur, organisations, établissements, memberships, RBAC, entitlements, catalogue de référence, ventes, factures, PaymentRecords, CashAccounts/CashMovements, Event Fabric/Outbox, AI Gateway, Agent Runtime partagé et Control Plane.
- **ZAMUREK** est un **produit commercial autonome** (marque, tarifs, canaux installables, métiers, UX) qui utilise **ces capacités communes** ; il possède l'extension métier omnicanale/venue, les parcours restaurant, réservation, vente au poids, mobilier, réparation et les clients installables. Ces extensions peuvent prendre la forme de modules NestJS distincts **dans le backend Monarque Connect** pour préserver transactions et autorisations ; le dépôt ZAMUREK détient les clients, les contrats d'intégration, les spécifications métier et les composants compatibles.
- **Aucun second backend de gestion commerciale** ne recalcule ou persiste séparément SalesOrder, Invoice, PaymentRecord, CashMovement, catalog items ni droits. ZAMUREK n'implémente ni fork de Monarque Connect ni moteur Mercur/Medusa/Saleor.
- **Déploiement** : un seul *data plane* commun possible pour les deux produits, API REST versionnée. Les applications restent installables (Android/Windows) ; pas de frontend web hébergé en production ZAMUREK. Monarque Connect peut garder ses propres canaux si autorisés par sa roadmap.
- **Tenancy au lancement** : conserver PostgreSQL **partagé** avec `organizationId` de Monarque Connect, renforcer scopes établissement + ownership + tests BOLA et RLS défensive si appropriée. **La proposition ZAMUREK « 1 DB par marchand » est remplacée pour V1** ; dédiées futures seulement après ADR et migrations testées. Pas de double synchronisation des commandes.
- **Multi-produit** : `organizationId` partagé quand même entreprise ; registre serveur stable et scopes produit pour plans, souscriptions, activations, overrides et quotas. Le prix ZAMUREK de 7 USD/mois reste une **hypothèse non validée**, inactive et non publiable comme tarif. Une souscription ZAMUREK ne donne accès qu'aux capacités explicitement autorisées pour ce produit, pas aux modules CRM/PURCHASES/PROJECTS/FairScale BUSINESS.
- **Devise** : préserver les organisations existantes et leur `defaultCurrency`. Les offres ZAMUREK peuvent conserver une source USD et des snapshots/taux USD→CDF marchand ; introduire un `PricingContext` + policy versionnée dans le Core sans modifier rétroactivement Sales/Invoice ni imposer USD aux autres produits.
- **Acheteurs** : comptes e-mail vérifiés pour checkout *online*. POS physique permet acheteur de passage **sans compte client**, mais opérateur/caisse authentifié, permission et session audités. Relation `BusinessParty` anonymisée ou profil walk-in contrôlé par tenant, pas de faux e-mail.
- **Agents** : une Event Fabric, un Model Gateway et un Agent Runtime communs (classes A0–A4, permissions tenant/scope/approval), outils sectoriels déclarés par ZAMUREK ; aucun tool avec accès SQL direct.
- **Facturation** : service canonique de documents du Core (invoice émise, reçu, ticket), rendu A4/thermique via contrat d'impression ; fiscalisation RDC **fail-closed** selon statut légal/marchand. Aucune mention « facture normalisée DGI » sans intégration vérifiée/homologuée applicable.

## Responsabilités et matrice
| Domaine | Source de vérité | Extension ZAMUREK / client |
|---|---|---|
| Organizations, Establishments, Auth, RBAC, FairScale | Monarque Connect | Onboarding et UX ; canal/scopes commerciaux |
| `Item`, prix et mesures monétaires | Monarque Connect | Food/weighted/repair/variant projections et politiques spécialisées |
| `SalesOrder`, `Invoice`, `PaymentRecord`, `CashMovement` | Monarque Connect | Workflow POS/service/menu et adaptation au canal |
| `CashSession`, terminal, tender, clôture, tickets | Nouveau module POS **dans le Core** | App de caisse Kotlin/Rust et périphériques locaux |
| Venue/mall, consentements d'adhésion, discovery | Module partagé de découverte isolé | App et parcours ZAMUREK, publication opt-in |
| Réservation, table, cuisine, repair | Modules sectoriels, backend intégré partagé | Canaux et interactions ZAMUREK |
| Event Fabric, Model Gateway, Agent Runtime | Monarque Connect | Agents/outils/assistants sectoriels ZAMUREK |
| Factures SaaS | Monarque Connect Billing | Offre produit ZAMUREK spécifique |

## Migration et sécurité

**Migration C1 autorisée après fusion du cadrage C0 et CI post-fusion verte :** préserver `resolveEffective(organizationId)` comme chemin strictement Monarque Connect. Remplacer les contraintes de chevauchement par des contraintes organisation/produit après backfill et contrôle; ne modifier aucune migration déjà publiée. Les droits partagés sont accordés par opération, jamais par ouverture générale du module. Voir B-02/B-03/B-05 de Docs/114 et le contrat C1 de Docs/116.

Migrations **additives, expand/contract, compatibilité API**, sans retirer les champs ni casser les phases clôturées. Exiger tests multi-org, multi-establishment, cross-product, idempotence et rétrocompatibilité. Les flux financiers exigent commandes transactionnelles atomiques ; aucune double écriture par synchronisation webhooks.

## Alternatives explicitement rejetées
1. Deux backends commerce indépendants et synchronisation bidirectionnelle : risque de double paiement / désynchronisation.
2. Copier modules NestJS de Monarque Connect dans ZAMUREK : maintenance multipliée.
3. Migrer immédiatement toute l'infrastructure Monarque Connect vers une DB par tenant : ampleur et risques disproportionnés.
4. Implémenter 10B avant de fixer les contrats métier, de politique et de produit : outils IA fragiles.
5. Lier commercialement un abonnement ZAMUREK aux offres Business/Enterprise : empêche adoption des petits commerces.

## Conséquences
La phase **10A.5** est insérée entre 10A et 10B ; la roadmap ZAMUREK et son prompt G1 autonome sont **supplantés**, non exécutables sans adaptation. Le code réalisé en 10A reste intact. Références : [spécification phase 10A.5](105_PHASE_10A5_CONVERGENCE_EXECUTION_SPEC.md), [interfaces](106_SHARED_PRODUCT_CONTRACTS.md), [contrôles](107_PHASE_10A5_ACCEPTANCE_GATES.md).
