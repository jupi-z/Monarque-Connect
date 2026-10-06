# 32 — Modèle produit Monarque Connect v1.1

## Objet

La v1.1 restaure les éléments qui faisaient la force du concept original de Monarque Connect, tout en conservant la nouvelle décision technique : **backend 100 % propriétaire, API-first, sans ERPNext/Frappe**.

## Les quatre piliers

### 1. Monarque Network
Créer de la visibilité et des opportunités :
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
Transformer l'activité en information utile :
- KPI ;
- tableaux de bord ;
- tendances ;
- alertes déterministes ;
- qualité opérationnelle.

L'IA avancée n'est pas nécessaire au MVP.

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
- audit.

## Boucle de valeur cible

`Network inquiry → CRM opportunity → quote → order → invoice → payment`

et :

`Stock need → Supplier RFQ → Purchase Order → Goods Receipt → Inventory`.

Les transactions structurées alimentent ensuite les KPI et alertes. Le réseau crée des opportunités et de la confiance ; le Business OS les transforme en opérations ; l'Intelligence rend l'historique utile ; le Control Plane permet d'exploiter le tout à l'échelle.

## Modèle de configuration

`Organization → BusinessType preset → Plan → Entitlements → Module activation → Establishments → Membership → Permission/scope`

Chaque couche a une responsabilité unique :
- **BusinessType** : configuration recommandée ;
- **Plan** : plafond commercial ;
- **Entitlement** : droit effectif ;
- **Activation** : module utilisé ou non ;
- **Membership/RBAC** : qui peut agir ;
- **Establishment scope** : où il peut agir.

## Non-objectifs

- reproduire tous les modules d'un ERP généraliste ;
- coder des variantes de produit séparées par secteur ;
- laisser le frontend définir la disponibilité d'une fonctionnalité ;
- donner un accès par simple présence d'un menu ;
- transformer les business types en enums rigides impossibles à faire évoluer.

## Critère de réussite

Un nouveau secteur doit pouvoir être ajouté principalement par :
- un nouveau business type ;
- un preset de modules ;
- éventuellement de nouvelles configurations ;
sans fork du backend et sans duplication des domaines existants.
