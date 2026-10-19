# 90 — Phase 9.5 : FairScale commercial core / pricing & capacity

**STATUT : EXECUTEE ET CLOTUREE — phase intermédiaire ENTRE 9 ET 10.**
**Norme : Docs/89 ; décisions : Docs/94 ; gates : Docs/92.**
Phase 9 (Messaging) est clôturée ; l'implémentation ne doit pas rouvrir les migrations/primitives des phases 0–9. Tous les changements sont des évolutions versionnées et testées.

## Objectif de livraison
Un backend capable de produire sans paiement réel (i) le catalogue en USD, (ii) un devis parfaitement déterministe sur la base du plan, cycle, promotions et établissements, (iii) l'éligibilité welcome liée à la même entreprise, (iv) les capacités sans tarification par collaborateur, et (v) une migration non destructive de l'existant. Le code 9.5 **ne peut pas déclarer qu'il encaisse**.

## Plan d'implémentation ordonné

### 9.5.1 — Contract-first et design
- Relever la baseline HEAD de main, vérifier docs 23/33/34/35/55/89 et les 45 migrations existantes Phase 9.
- Rédiger le schema proposal et OpenAPI pour catalogue/price quote/estimation d'extensions/capacités ; mettre à jour DTO et exemples ; tests contractuels avant code.
- Fixer ownership : Platform Billing/Price Catalog possède les prix, Product Entitlements les droits, Tenancy les memberships et établissements, SALES reste propriétaire des factures métier.
- Rédiger ADR additionnel **uniquement** si un choix diverge de Docs/94. Pas de changement silencieux de sémantique API.

### 9.5.2 — Schéma additif, migration et seed V2
- Évaluer de façon explicite la réutilisation de `PlanVersion` (currency + billingPeriod sans prix), `Subscription` et `PlanVersionQuota` ; choisir FK vers `PriceVersion`/`PriceComponent` ou version conjointe sans créer deux autorités contradictoires.
- Référentiel de prix immutable USD : montant de base en cents, cycle MONTHLY/ANNUAL, planCode et version, statut DRAFT/ACTIVE/RETIRED, startsAt, publishAt, audit. Garder v1 EUR historique inchangée. Créer V2+ selon stratégie cohérente des cycles et rendre les versions sélectionnables ; ne jamais modifier les valeurs d'anciens abonnements.
- Créer `BillingCustomer`, lien(s) prouvés entre identité commerciale et organizations, contrôles d'ownership, états de vérification et piste d'audit. Permettre sociétés distinctes sans confusion de groupes.
- Conserver un historique durable des promotions consommées, y compris événements de paiement futurs, au niveau BillingCustomer avec verrou/unique contraint. Aucun usage d'un booléen client modifiable.
- Cataloguer les extensions d'établissement avec priceVersion/cycle/capacité/contrat et snapshots pour les devis ; possibilité de réviser ultérieurement les prix par création de version.
- Migration démontrée base vide + upgrade depuis main Phase 9, sans perte de références ni suppression des plan versions v1 ; seeds rejouables sans écraser prix publiés.

### 9.5.3 — Prix calculés côté serveur
- Service pur PricingQuote / Money : entrées contrôlées plan, période, add-ons, date, BillingCustomer ; sortie montant avant taxes, remise, lignes détaillées, total, currency, version catalog, effective/renewal prices, expiresAt.
- OPERATIONS = 1500 cents mensuels / 14400 cents annuels ; BUSINESS = 4500 / 43200 ; ENTERPRISE = 18000 / 172800. Welcome = 1275 / 3825 / 15300 cents pour ses mensualités.
- Extension : 1000 cents/mois, 12000 cents/an par établissement actif supplémentaire, hors réduction sur base. Aucun prix négatif, incohérence de devise, combinaison promotion illégale ou confiance dans `amount` du navigateur.
- Les devis expirés, les prix archivés et les requêtes en parallèle ne doivent pas donner un accès à un ancien montant inapproprié.
- Pas de promotion automatique sur une invoice future tant qu'aucun encaissement/échéance n'a été confirmé par 9.6. Bien séparer « éligible », « réservé », « consommé ».

### 9.5.4 — Quotas, capacité et accès
- Pour CONNECT, conserver une limite d'abus de 5 membres + 1 établissement.
- Pour OPERATIONS/BUSINESS/ENTERPRISE, retirer **toute limite commerciale MAX_USERS**, y compris les usages dans `prisma/seed.ts`, `src/tenancy/organization.service.ts`, `src/tenancy/invitation.service.ts`, `src/entitlements/quota.service.ts` et tests de capacité. Ne jamais retirer authentification, membership, RBAC, scopes ni rate limits.
- Inclure 1/3/10 établissements actifs sur OPERATIONS/BUSINESS/ENTERPRISE ; capacity effective = inclus + add-ons actifs consentis et payés + éventuels overrides audités. Ajouter/restreindre atomiquement un établissement et empêcher `used + reserved > effective limit`.
- Sur diminution de capacité : ne pas détruire établissements/historique ; politique de suspension d'activation des établissements excédentaires et régularisation explicite, sans croiser les données privées.
- Un warehouse ne vaut pas établissement ; aucune inférence depuis le nombre d'employés ou le chiffre d'affaires.
- Maintenir et élargir la projection `/capabilities` pour capacité commerciale sans la transformer en autorité d'accès.
- Toute dérogation temporaire a une date d'expiration, un acteur plateforme, une raison et audit/outbox.

### 9.5.5 — Validation et clôture
- DB integration, HTTP/E2E, replay, concurrence, cross-tenant, quota, calculs financiers exacts, différences de cycle, extensions et refus.
- Vérifier qu'un tenant BUSINESS avec 200 membres garde BUSINESS et peut opérer avec mêmes droits ; un CONNECT avec >5 reste protégé.
- Vérifier immutabilité des versions prix et compatibilité historique ; teste les limites START/END UTC et erreurs 409/403/422.
- CI PR hébergée + CI post-merge main vertes, audit, mise à jour Docs/93 et création preuve de clôture dédiée. Ne pas avancer à 9.6 avant ces gates.

## Portes de non-régression
Le script migration ne supprime aucun enum/table/contrainte historique sans plan de transition. Tester scénarios Phases 1–9, surtout invitations, tenancy, entitlements, Sales/Invoices, Inventory, Messaging. Le rôle tenant OWNER ne devient jamais PLATFORM_ADMIN. Ni tarifs ni capacités ne sont écrits en dur dans les clients.

## Revue des risques
- Risque « unlimited users » = coûts imprévus : protections techniques *fair usage* indépendantes des prix sans facturation à l'effectif.
- Risque planVersion un seul billingPeriod : gérer versions distinctes mensuelles/annuelles ou type de prix indépendant, éviter coexistence incohérente.
- Risque promotion réutilisée par multiorg : BillingCustomer autorité commerciale avec preuves et recours.
- Risque capacité désactivée sur downgrade : garder historique et export, revalidation permission efficace.

**Sortie 9.5 : fondation autonome et testée, sans passerelle de paiement prétendument fonctionnelle.**

**Suivi GitHub :** [issue #122](https://github.com/jupi-z/Monarque-Connect/issues/122).
