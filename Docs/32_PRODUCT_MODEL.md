# 32 — Modèle produit Monarque Connect

## Objet

Ce document décrit le modèle produit courant de Monarque Connect sous la baseline v1.2 : **backend propriétaire, API-first, multi-tenant, AI-native dans ses fondations, sans ERPNext/Frappe**.

## Les quatre piliers

### 1. Monarque Network
Créer de la visibilité, de la confiance et des opportunités :
- profil public ;
- vérification et signaux de confiance publiables ;
- catalogue public ;
- découverte d'entreprises ;
- connexions B2B ;
- demandes commerciales ;
- sourcing/RFQ vers partenaires ;
- messagerie.

### 2. Monarque Business OS
Exécuter les opérations quotidiennes :
- organisations et établissements ;
- clients/fournisseurs ;
- CRM ;
- ventes ;
- achats ;
- stock ;
- caisse/dépenses ;
- projets légers ;
- documents.

### 3. Monarque Intelligence
Transformer l'activité en information exploitable :
- faits structurés ;
- événements de domaine ;
- KPI ;
- tableaux de bord ;
- tendances ;
- alertes déterministes ;
- prévisions et recommandations gouvernées ;
- assistance conversationnelle puis agents, uniquement après validation.

Le Core transactionnel reste déterministe. Les fonctions probabilistes avancées sont progressives et ne constituent jamais la source de vérité métier.

### 4. Monarque Control Plane
Industrialiser Monarque Connect comme SaaS :
- tenants ;
- types d'entreprise ;
- plans ;
- module catalog ;
- entitlements ;
- quotas ;
- statut/suspension ;
- opérations de support ;
- gouvernance Intelligence/IA ;
- audit.

## Boucles de valeur cibles

`Network inquiry → CRM opportunity → quote → order → invoice → payment`

`Stock need → Supplier RFQ → Purchase Order → Goods Receipt → Inventory`

`Business facts → Domain Events → Metrics/Knowledge → Intelligence → Recommendations → Authorized Actions`

Le réseau crée les opportunités et la confiance ; le Business OS transforme ces opportunités en opérations ; l'Event Fabric conserve une mémoire structurée ; Intelligence exploite cette mémoire ; le Control Plane rend l'ensemble gouvernable à l'échelle.

## Modèle de configuration

`Organization → BusinessType preset → Plan → Entitlements → Module activation → Establishments → Membership → Permission/scope`

Chaque couche a une responsabilité unique :
- **BusinessType** : configuration recommandée ;
- **Plan** : plafond commercial ;
- **Entitlement** : droit effectif ;
- **Activation** : module utilisé ou non ;
- **Membership/RBAC** : qui peut agir ;
- **Establishment scope** : où il peut agir.

## Modèle AI-native

`Deterministic Core → Event Fabric → Knowledge Layer → Intelligence Engine → Agent Runtime → Authorized Core Commands`

L'IA observe et propose ; le Core valide et exécute.

## Non-objectifs

- reproduire tous les modules d'un ERP généraliste ;
- coder des variantes de produit séparées par secteur ;
- laisser le frontend définir la disponibilité d'une fonctionnalité ;
- donner un accès par simple présence d'un menu ;
- transformer les business types en enums rigides ;
- rendre les parcours transactionnels dépendants d'un fournisseur IA ;
- permettre à un agent de contourner RBAC, entitlements ou confirmation humaine.

## Critère de réussite

Un nouveau secteur doit pouvoir être ajouté principalement par :
- un business type ;
- un preset de modules ;
- des configurations ;
sans fork du backend ni duplication des domaines existants.

Une nouvelle capacité d'intelligence doit pouvoir être ajoutée sans réécrire le Core ni déplacer la source de vérité hors PostgreSQL.
