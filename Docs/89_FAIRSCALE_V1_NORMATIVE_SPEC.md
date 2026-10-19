# 89 — Monarque FairScale V1 : spécification normative

**Statut : DECISION PRODUIT VALIDEE ; Phase 9.5 IMPLEMENTEE ET CLOTUREE ; Phase 9.6 EN EXECUTION CONTRACT-FIRST.**
**Baseline de préparation : main@becef9a96163b2331e1d459583d6dde551857c73 (Phase 9 clôturée).**
**Propriétaire : Monarque Group S.A.S.**  
**Exécution : Phase 9.5 (fondations) puis Phase 9.6 (cycle commercial), AVANT Phase 10.**

Ce document décrit la **cible V1**. La Phase 9.5 réalise le catalogue, le pricing, les promotions de devis, les capacités et l'identité de facturation préparatoire ; la Phase 9.6 reste nécessaire pour les paiements et l'activation commerciale. Les entitlements par module restent ceux de Docs/33. Les nouvelles règles de capacité et prix se substituent aux *anciennes valeurs seedées* uniquement via nouvelles versions et migrations compatibles. Voir Docs/96 pour les preuves.

## 1. Philosophie et invariants

FairScale sépare : (a) **plan fonctionnel** / modules, (b) **capacité** / établissements et ressources, (c) **services optionnels** et (d) **identité de facturation** / unicité des avantages de bienvenue. Une grande société peut rester OPERATIONS si seules ces fonctions lui sont utiles. Une boutique ayant besoin de gérer ses stocks choisit BUSINESS. Ni taille, ni chiffre d'affaires, ni secteur ne force ENTERPRISE.

Pas de facturation à l'utilisateur interne sur les forfaits payants ; les autorisations, RBAC, limites de sécurité et anti-abus restent applicables. Pas de commission sur les ventes, commandes ou factures commerciales des tenants. La facturation **SaaS de Monarque Group** ne réutilise jamais les factures SALES des entreprises utilisatrices.

## 2. Catalogue tarifaire approuvé

Tous les tarifs sont en **USD** pour le forfait de base, hors éventuels impôts/frais à déclarer séparément :

| Plan | Mensuel normal | Trois premières mensualités admissibles (-15 %) | Chaque année payée d'avance (-20 %) |
|---|---:|---:|---:|
| CONNECT | 0,00 $ | — | — |
| OPERATIONS | 15,00 $ | 12,75 $ | 144,00 $ |
| BUSINESS | 45,00 $ | 38,25 $ | 432,00 $ |
| ENTERPRISE | 180,00 $ | 153,00 $ | 1 728,00 $ |

L'annuel = prix mensuel × 12 × 0,80 ; l'avantage de 20 % se répète **à chaque paiement annuel** et ne disparaît pas à la deuxième année. L'annuel se paie en une fois au début de chaque période. Aucun cumul des -15 % et -20 % sur une facture.

Prix immuables/versionnés, snapshots du devis et de la facture, montants stockés/calculés en unités mineures entières (cents USD) et prorata arrondi au centime en half-up ; jamais de floating point JS comme source de vérité. Conditions des hausses futures, échéances et renouvellements annoncées avant engagement. Aucune taxe/statut fiscal implicite ou non vérifié.

## 3. Éligibilité des plans

- CONNECT : réseau B2B, profil, catalogue, trust, discovery, connections, inquiries et Messaging soumis à ses politiques de vérification ;
- OPERATIONS : CONNECT + CRM, SALES, EXPENSES, DOCUMENTS, INTELLIGENCE_BASIC (la Phase 10 livrera l'intelligence effective) ;
- BUSINESS : OPERATIONS + PURCHASES, INVENTORY, CASH, PROJECTS ;
- ENTERPRISE : fonctionnalités BUSINESS + capacité et gouvernance contractuelles configurables, services de support renforcé **seulement lorsqu'effectivement livrés et contractés** ;
- MANAGED est un service transversal, **pas un cinquième plan**.

Le type d'entreprise reste un preset et ne constitue jamais une autorisation. Aucun module hors plan n'est accessible sauf override plateforme explicite, limité et audité. ENTERPRISE à 180 $ n'inclut **pas implicitement** hébergement dédié, SLA 24/7, intégration illimitée, fiscalité réglementée ou agent autonome.

## 4. Capacités et extensions

Configuration de lancement retenue sous mandat de préparation (nouveaux paramètres proposés ; ne pas modifier les versions historiques) :

| Plan | Établissements actifs inclus | Membres internes |
|---|---:|---|
| CONNECT | 1 | jusqu'à 5 (garde-fou gratuit, sans paiement) |
| OPERATIONS | 1 | sans prix ni plafond commercial par utilisateur |
| BUSINESS | 3 | sans prix ni plafond commercial par utilisateur |
| ENTERPRISE | 10 | sans prix ni plafond commercial par utilisateur |

L'établissement facturable est une unité opérationnelle active gérée dans l'application, tenant-scoped, et **pas** un Warehouse rattaché. Aucun site extérieur non géré dans Monarque Connect n'est facturé. Plusieurs personnes au sein d'un tenant ne créent aucun supplément.

**Extension de référence V1** : 10,00 USD par établissement supplémentaire actif/mois ou 120,00 USD par établissement supplémentaire actif/année prépayée sur chaque plan payant, hors remises de base. ENTERPRISE peut proposer des extensions contractuelles versionnées. Cette valeur est une **nouvelle décision de paramétrage proposée par délégation**, modifiable par une nouvelle version commerciale avant lancement ; elle doit vivre en catalogue, jamais en constante métier. Aucune facturation ni activation payante sans consentement traçable. Les capacités de stockage/API/IA à tarifer ultérieurement restent mesurables mais non monétisées automatiquement tant qu'une grille publique n'est pas adoptée.

Capacité effective = capacité incluse + add-ons actifs payés + override temporaire plateforme documenté ; modification atomique des quotas. Un addon demandé mais non réglé ne donne aucun droit. Downgrade sous le nombre de sites utilisés : pas de suppression ni de prélèvement furtif ; proposer désactivation planifiée des sites ou conservation des extensions avec accord explicite.

## 5. Promotions, identité et anti-abus

**WELCOME_MONTHLY15** : -15 % sur le forfait de base uniquement aux trois premières échéances **mensuelles payées** d'une entreprise qui démarre sa première souscription payante en mensuel. Attribution unique à la première souscription payante confirmée ; une échéance répétée/remboursée ne peut pas compter deux fois. Une résiliation ne réinitialise jamais l'éligibilité. Si l'entreprise bascule vers l'annuel, le reliquat mensuel éventuel est définitivement perdu ; un futur retour mensuel n'ouvre pas une seconde fenêtre de bienvenue.

**ANNUAL20** : -20 % sur le forfait de base à **toute échéance annuelle**, initiale ou de renouvellement, même si le client a auparavant utilisé WELCOME_MONTHLY15. Aucun cumul sur une même facture ; les remises ne couvrent pas taxes, services gérés, extensions ou frais de prestataires externes.

Une seule identité commerciale **BillingCustomer** par entreprise cliente réellement reconnue ; les organisations de la même entité légale peuvent partager ce profil et la promotion. Deux entités légales distinctes ne sont pas fusionnées au seul motif d'un propriétaire commun. Déduplication proportionnée par preuves légitimes, revue humaine et possibilité de contestation ; ne pas rendre le RCCM obligatoire pour tout compte gratuit.

## 6. Cycle de souscription

- Création publique → CONNECT et établissement principal ; upgrades payants activés **après paiement vérifié** ou exemption administrative explicite, bornée et auditée.
- Échéances UTC, [start, end), règles de dates fin de mois/années bissextiles déterministes. Afficher montant initial et prochain renouvellement avant consentement ; snapshot de tarif/discount/add-on.
- Upgrade immédiat : devis serveur, consentement, facture supplémentaire proratisée ; le crédit de période inutilisée part du **montant effectivement payé**, pas du prix catalogue non remisé ; activer droits après règlement.
- Downgrade et annuel→mensuel à l'échéance suivante par défaut ; changements et extensions avec date d'effet claire.
- Renouvellement manuel/automatique seulement si les conditions de consentement/mandat sont respectées ; aucun prélèvement surprise.
- Annulation : stoppe les renouvellements, maintient les droits jusqu'au terme payé ; aucune suppression automatique de données.
- Échec de paiement : grâce V1 de **7 jours** après échéance, rappel, statut PAST_DUE ; après grâce, restriction des fonctionnalités payantes, maintien de l'accès au compte, factures plateforme et export conforme à Docs/41. Résolution de l'état doit respecter les transitions existantes (ne pas rendre PAST_DUE actif indéfiniment).
- Litiges, rétrofacturation, remboursement, prorata des extensions et rétention exigent des états déterministes et politiques publiées avant production ; ne pas improviser de remboursement sur base de l'ordre des webhooks.
- Aucune création « PAID » à partir d'une redirection frontend. Un paiement doit être authentifié et rapproché.

## 7. Architecture cible et intégrité

Conserver NestJS 12 / TypeScript / Prisma 7 / PostgreSQL 17 / Event Fabric / API-first. Créer un **Platform Billing** distinct de SALES et un contrôle des prix séparé de l'entitlement moteur déjà livré en Phase 2. Conserver l'identité tenant et les liens entre PlanVersion et Subscription.

Modèles conceptuels à détailler dans le schéma proposé de 9.5/9.6, en réutilisant les agrégats existants : BillingCustomer, BillingCustomerOrganization, PriceVersion, PriceComponent, SubscriptionBillingTerm, BillingQuote, BillingInvoice/Line (snapshots), BillingPaymentAttempt, BillingPayment/Refund, BillingProviderEventInbox, PromotionEligibility/Redemption, SubscriptionAddon et audit/outbox. Relations FK, uniqueness temporelle, montants cohérents, ledger non mutable et traitement idempotent transactionnel. Ne pas ajouter de doublons inutiles aux tables déjà existantes.

API contract-first, routes tenant sous `/api/v1/organizations/{organizationId}/...` et routes plateforme sous `/api/v1/platform/...`. Ajouter catalogue read-only, quote, purchase/checkout, subscriptions, addons, platform invoices/payments, cycle cancellation/renewal, opérateur et webhook signé fournisseur. Serveur = seule autorité prix/permissions ; permissions OWNER/ADMIN et rôles plateforme distincts ; aucun secret ou donnée carte dans audit/Outbox/logs.

Un fournisseur de paiement est un adaptateur interchangeable ; vérifier signature, montant, devise, order ID, événement unique, états et rapprochement. CI doit prouver doublons, désordre et concurrence webhooks, redéploiement de migrations, absence de fuite cross-tenant, contrôle des quotas, et rétrocompatibilité des modules existants.

## 8. Frontières et lancement

Hors V1 : pourcentage sur ventes métier, taxation automatique sans expertise, infrastructure dédiée « incluse » automatiquement, tarifs IA implicites, déduction automatique de la taille légale, suspension sans recours, prix par utilisateur, système de paiement maison sans agrément. Aucun lancement payant sans adaptateur réel validé **ou** circuit manuel encadré rapprochant effectivement les fonds avec contrôle opérateur. Un faux fournisseur en mémoire n'est jamais autorisé en staging/prod.

La Phase 9 reste clôturée. Phase 9.5 = Core commercial/pricing/addons/contrats ; Phase 9.6 = Billing/payments/gouvernance minimale/hardening. Les Phases 10, 11, 11.5 et 12 restent ensuite inchangées sur leur périmètre. La Phase 11 conserve la responsabilité du Control Plane **global**, même si les commandes Billing indispensables sont livrées en 9.6.

**Traçabilité :** Docs/90 (9.5), Docs/91 (9.6), Docs/92 (acceptance), Docs/93 (statuts), Docs/94 (ADR-038). Les nouveaux prix, extensions et capacités présentés ici sont la **cible** tant que leurs migrations n'ont pas été livrées.
